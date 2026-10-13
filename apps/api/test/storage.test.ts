import { describe, expect, it } from 'vitest';
import { S3PhotoStorage } from '../src/storage.ts';

const local = () =>
  new S3PhotoStorage({ bucket: 'b', endpoint: 'http://localhost:9000', accessKeyId: 'k', secretAccessKey: 's' });

describe('presigned URL host', () => {
  it('uses the local endpoint for a local viewer', async () => {
    const url = new URL(await local().forViewer('localhost:3000').presignUpload('photos/a.jpg', 'image/jpeg'));
    expect(url.origin).toBe('http://localhost:9000');
    expect(url.pathname).toBe('/b/photos/a.jpg');
  });

  it('swaps in the viewer host so a phone on the LAN can reach object storage', async () => {
    const s = local();
    expect(s.publicEndpointFor('192.168.1.117:5173')).toBe('http://192.168.1.117:9000');
    const url = new URL(await s.forViewer('192.168.1.117:5173').presignDownload('photos/a.jpg'));
    expect(url.origin).toBe('http://192.168.1.117:9000');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    // the signature is computed for that host, so it differs from the local one
    const localUrl = new URL(await s.presignDownload('photos/a.jpg'));
    expect(localUrl.searchParams.get('X-Amz-Signature')).not.toBe(url.searchParams.get('X-Amz-Signature'));
    expect(s.forViewer('192.168.1.117:5173')).not.toBe(s);
    expect(s.forViewer(undefined)).toBe(s);
  });

  it('prefers an explicit public endpoint and never rewrites a non-loopback endpoint', () => {
    const explicit = new S3PhotoStorage({ bucket: 'b', endpoint: 'http://localhost:9000', publicEndpoint: 'https://s3.example.com' });
    expect(explicit.publicEndpointFor('10.0.0.5:5173')).toBe('https://s3.example.com');
    const remote = new S3PhotoStorage({ bucket: 'b', endpoint: 'https://s3.us-east-1.amazonaws.com' });
    expect(remote.publicEndpointFor('10.0.0.5:5173')).toBeUndefined();
    const aws = new S3PhotoStorage({ bucket: 'b' });
    expect(aws.publicEndpointFor('10.0.0.5:5173')).toBeUndefined();
    expect(aws.forViewer('10.0.0.5:5173')).toBe(aws);
  });
});
