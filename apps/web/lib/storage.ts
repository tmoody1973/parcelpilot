import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Object storage for page images (MinIO locally, S3-compatible in production). Same env names as the Python worker.
let client: S3Client | undefined;
function s3(): S3Client {
  return (client ??= new S3Client({
    endpoint: process.env["S3_ENDPOINT"] ?? "http://localhost:9100",
    region: process.env["S3_REGION"] ?? "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: process.env["S3_ACCESS_KEY_ID"] ?? "parcelpilot", secretAccessKey: process.env["S3_SECRET_ACCESS_KEY"] ?? "parcelpilot-local" },
  }));
}

export async function getObjectStream(key: string): Promise<{ body: ReadableStream; contentType: string } | null> {
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: process.env["S3_BUCKET"] ?? "parcelpilot-sources", Key: key }));
    if (!out.Body) return null;
    return { body: out.Body.transformToWebStream(), contentType: out.ContentType ?? "application/octet-stream" };
  } catch (e) {
    if ((e as { name?: string }).name === "NoSuchKey") return null;
    throw e;
  }
}
