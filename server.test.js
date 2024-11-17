const request = require('supertest');
const express = require('express');
const app = require('./server'); // Export app from server.js

describe('Instagram Video API', () => {
  test('GET /download without URL should return 400', async () => {
    const response = await request(app)
      .get('/download')
      .expect('Content-Type', /json/)
      .expect(400);

    expect(response.body.error).toBe('URL parameter is required');
  });

  test('GET /download with valid URL should return video', async () => {
    const testUrl = 'https://www.instagram.com/reel/sample';
    const response = await request(app)
      .get(`/download?url=${encodeURIComponent(testUrl)}`)
      .expect(200);

    expect(response.headers['content-type']).toBe('video/mp4');
    expect(response.headers['content-disposition']).toContain('attachment; filename=');
  });
});