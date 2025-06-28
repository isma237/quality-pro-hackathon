const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const s3 = new S3Client();
const bucketName = process.env.BUCKET_NAME;

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);
const tableName = process.env.TABLE_NAME;


exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        throw new Error(`postMethod only accepts POST method, you tried: ${event.httpMethod} method.`);
    }
    // All log statements are written to CloudWatch
    console.info('received:', event);

    // Get id and name from the body of the request
    const body = JSON.parse(event.body);
    const {name, objective, description, date, campaign_type, end_date } = body
    const Id = uuidv4()

    var params = {
        TableName : tableName,
        Item: { 
            Id, 
            name, 
            objective, 
            description, 
            date,
            end_date,
            campaign_type,
            METADATA : `CAMPAIGN#${Id}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
    };

    try {
        const data = await ddbDocClient.send(new PutCommand(params));
        console.log("Success - item added or updated", data);

        // Crée les "dossiers" dans S3
        await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: `${slugify(name)}/` }));
        await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: `${slugify(name)}/audio/` }));
        await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: `${slugify(name)}/output/` }));


        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            },
            body: JSON.stringify(params.Item)
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


function slugify(str) {
    return str
      .toLowerCase()
      .replace(/\s+/g, '-')           // espaces → tirets
      .replace(/[^a-z0-9\-]/g, '')    // retire caractères non autorisés
      .replace(/\-+/g, '-');          // plusieurs tirets → un seul
  }