const express = require('express');
const axios = require('axios');
const rax = require('retry-axios');
const cors = require('cors');
const logger = require('./logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure axios with retries and longer timeout
const axiosInstance = axios.create({
    timeout: 15000,
    headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
});

rax.attach(axiosInstance);

app.use(cors());
app.use(express.json());

const validateInstagramUrl = (url) => {
    const regex = /^https:\/\/(?:www\.)?instagram\.com\/reel\/([A-Za-z0-9_-]+)/;
    return regex.test(url);
};

const fetchVideoInfo = async (url) => {
    try {
        const apiUrl = `https://pragyaninstagr.vercel.app/?url=${encodeURIComponent(url)}`;
        const response = await axiosInstance.get(apiUrl, {
            validateStatus: status => status === 200,
            raxConfig: {
                retry: 3,
                retryDelay: 1000,
                statusCodesToRetry: [[408, 429], [500, 599]],
                onRetryAttempt: (err) => {
                    const cfg = rax.getConfig(err);
                    logger.info(`Retry attempt #${cfg.currentRetryAttempt}`);
                }
            }
        });

        // Check if response is HTML instead of JSON
        const contentType = response.headers['content-type'];
        if (contentType && contentType.includes('text/html')) {
            throw new Error('API returned HTML instead of JSON');
        }

        if (!response.data || typeof response.data !== 'object') {
            throw new Error('Invalid API response format');
        }

        return response.data;
    } catch (error) {
        logger.error('API Error:', {
            url,
            error: error.message,
            response: error.response?.data
        });
        throw new Error(`Failed to fetch video info: ${error.message}`);
    }
};

const fetchVideo = async (videoUrl) => {
    try {
        const response = await axiosInstance.get(videoUrl, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'Range': 'bytes=0-',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            maxContentLength: 100 * 1024 * 1024, // 100MB max
            maxBodyLength: 100 * 1024 * 1024
        });

        return {
            data: response.data,
            headers: response.headers
        };
    } catch (error) {
        logger.error('Video fetch error:', {
            url: videoUrl,
            error: error.message
        });
        throw new Error(`Failed to fetch video: ${error.message}`);
    }
};

app.get('/download', async (req, res) => {
    const startTime = Date.now();
    const { url } = req.query;

    try {
        if (!url) {
            return res.status(400).json({ error: 'URL parameter is required' });
        }

        if (!validateInstagramUrl(url)) {
            return res.status(400).json({ error: 'Invalid Instagram reel URL format' });
        }

        logger.info('Processing download request', { url });

        // First, get the video info from the API
        const videoInfo = await fetchVideoInfo(url);
        
        if (!videoInfo.status === 'success' || !videoInfo.data?.videoUrl) {
            logger.error('Invalid video info response', { videoInfo });
            return res.status(400).json({ error: 'Failed to get video URL from API' });
        }

        // Then fetch the actual video
        const videoResponse = await fetchVideo(videoInfo.data.videoUrl);

        const contentType = videoResponse.headers['content-type'];
        if (!contentType?.includes('video')) {
            logger.error('Invalid content type', { contentType });
            return res.status(400).json({ error: 'Invalid video content type' });
        }

        // Set appropriate headers for video streaming
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', videoResponse.headers['content-length']);
        res.setHeader('Content-Disposition', `attachment; filename=${videoInfo.data.filename}`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=3600');

        // Send the video buffer
        res.send(videoResponse.data);

        logger.info('Download completed', {
            processingTime: Date.now() - startTime,
            contentLength: videoResponse.headers['content-length']
        });

    } catch (error) {
        logger.error('Download error:', {
            url,
            error: error.message,
            stack: error.stack
        });

        const errorMessage = process.env.NODE_ENV === 'development' 
            ? error.message 
            : 'Failed to process video download';

        res.status(500).json({
            error: 'Internal server error',
            message: errorMessage
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', {
        error: err.message,
        stack: err.stack,
        path: req.path
    });

    res.status(500).json({
        error: 'Something went wrong',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        logger.info(`Server running on port ${PORT}`);
    });
}

module.exports = app;