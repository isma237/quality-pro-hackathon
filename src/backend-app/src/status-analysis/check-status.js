const AWS = require('aws-sdk');
const stepfunctions = new AWS.StepFunctions();
const dynamodb = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME;
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN

const HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
};
const POST_CALL_SURVEY = 'Post Call Survey';
exports.handler = async (event) => {
    const { fileName, campaignId } = event.pathParameters;

    try {
        const audioRecord = await dynamodb.get({
                TableName: TABLE_NAME,
                Key: {
                    Id: fileName,
                    METADATA: `AUDIO#${campaignId}`
                }
        }).promise();
    
        if (!audioRecord.Item) {
            return {
                statusCode: 200,
                headers: HEADERS,
                body: JSON.stringify({
                    fileName,
                    campaignId,
                    analysisStatus: 'EN_COURS',
                    lastUpdated: new Date().toISOString(),
                })
            };
        }

        const { executionId } = audioRecord.Item;
        
        // 2. Vérifier le statut de la Step Function
        const execution = await stepfunctions.describeExecution({
            executionArn: `${STATE_MACHINE_ARN}:${executionId}`
        }).promise();

        if(execution.status === 'SUCCEEDED'){
            // 4. Construire bedrockAnalysis
            let bedrockAnalysis = {};
            if (audioRecord.Item.analysisStatus === 'COMPLETE') {
                if (audioRecord.Item.campaign_type === POST_CALL_SURVEY) {
                    bedrockAnalysis['satisfaction_globale'] = audioRecord.Item.bedrockResult?.satisfaction_globale;
                    bedrockAnalysis['net_promoter'] = audioRecord.Item.bedrockResult?.net_promoter;
                } else {
                    bedrockAnalysis['prompt_identification_sujet'] = audioRecord.Item.bedrockResult?.prompt_identification_sujet;
                    bedrockAnalysis['prompt_statut_resolution'] = audioRecord.Item.bedrockResult?.prompt_statut_resolution;
                    if (audioRecord.Item.bedrockResult?.prompt_bilan_global) {
                        try {
                            const prompt_bilan_global = JSON.parse(audioRecord.Item.bedrockResult.prompt_bilan_global);
                            bedrockAnalysis['scoreglobalsur_10'] = prompt_bilan_global.scoreglobalsur_10;
                        } catch (e) {
                            bedrockAnalysis['scoreglobalsur_10'] = null;
                        }
                    }
                }
            }

            return {
                statusCode: 200,
                headers: HEADERS,
                body: JSON.stringify({
                    fileName,
                    campaignId,
                    analysisStatus: audioRecord.Item.analysisStatus,
                    lastUpdated: new Date().toISOString(),
                    audio: {
                        name: audioRecord.Item.name,
                        analysisOutput: audioRecord.Item.analysisOutput,
                        status: audioRecord.Item.analysisStatus,
                        createdAt: audioRecord.Item.createdAt,
                        Id: audioRecord.Item.Id,
                        bedrockAnalysis: audioRecord.Item.analysisStatus === 'COMPLETE' ? bedrockAnalysis : {},
                    }
                })
            };

        }else{
            return {
                statusCode: 200,
                headers: HEADERS,
                body: JSON.stringify({
                    fileName,
                    campaignId,
                    analysisStatus: execution.status === 'ABORTED' ? 'ANALYSE_ANNULEE' : execution.status === 'FAILED' ? 'ANALYSE_ECHEC' : 'EN_COURS',
                    lastUpdated: new Date().toISOString(),
                })
            };
        }
    }catch(error) {
        console.error('Erreur:', error);
        return {
          statusCode: 500,
          headers: HEADERS,
          body: JSON.stringify({ error: error.message })
        };
    }
}  