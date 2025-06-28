const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const bucketName = process.env.BUCKET_NAME;

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        throw new Error(`postMethod only accepts POST method, you tried: ${event.httpMethod} method.`);
    }

    const { campaignId } = event.pathParameters || {};

    const { fileNames } = JSON.parse(event.body);
    const s3 = new S3Client();

    try {
        const presignedUrls = await Promise.all(
            fileNames.map(async (file) => {
                const command = new PutObjectCommand({
                    Bucket: bucketName,
                    Key: `${campaignId}/audio/${file.fileName}`,
                    ContentType: file.ContentType,
                });
                const url = await getSignedUrl(s3, command, { expiresIn: 1800 });
                return { 
                    fileName: file.fileName,
                    url
                };
            })
        );

        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            },
            body: JSON.stringify(presignedUrls)
        };
    } catch (error) {
        console.log("Error", error.stack);
        return {
            statusCode: 500,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            },
            body: JSON.stringify({ error: error.message })
        };
    }
}
