const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');



const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);
const tableName = process.env.TABLE_NAME;

exports.handler = async (event) => {
    console.info('received:', event);
    
    try {
        // Paramètres pour scanner la table
        const params = {
            TableName: tableName,
            FilterExpression: "begins_with(METADATA, :prefix)",
            ExpressionAttributeValues: {
                ":prefix": "CAMPAIGN#"
            }
        };

        const data = await ddbDocClient.send(new ScanCommand(params));
        const sortedItems = data.Items.sort((a, b) => {
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type,Authorization"
            },
            body: JSON.stringify(sortedItems)
        };
        
    } catch (error) {
        console.error("Erreur lors de la récupération des campagnes:", error);
        return {
            statusCode: 500,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type,Authorization"
            },
            body: JSON.stringify({ error: "Erreur lors de la récupération des campagnes. Merci de réessayer dans un instant" })
        };
    }

}