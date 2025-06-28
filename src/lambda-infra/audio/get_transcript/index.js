const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const dynamodb = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Récupère le contenu du transcript depuis S3
 * @param {string} bucket - Nom du bucket S3
 * @param {string} key - Clé du fichier transcript (outputKey)
 * @returns {Promise<Object>} - Le contenu JSON du transcript
 */
exports.handler = async (event) => {
  console.log('Début de la récupération du transcript. Event reçu :', JSON.stringify(event));
  const bucket = event.bucket;
  const key = event.outputKey;
  const jobName = event.jobName;
  const fileNameKey = event.key;

  if (!bucket || !key) {
    console.error('Paramètres manquants : bucket et outputKey sont requis');
    throw new Error('Paramètres manquants : bucket et outputKey sont requis');
  }

  try {
    console.log(`Tentative de récupération du fichier transcript depuis S3 : bucket=${bucket}, key=${key}`);
    const data = await s3.getObject({ Bucket: bucket, Key: key }).promise();
    console.log('Fichier transcript récupéré avec succès depuis S3.');

    const transcriptJson = JSON.parse(data.Body.toString('utf-8'));

    let audio_segments = transcriptJson.results?.audio_segments
    let dialogue_segments_cleaned = audio_segments.map(({ items, ...rest }) => rest);

    console.log(dialogue_segments_cleaned);

    const campaignId = fileNameKey.split('/')[0]
    const fileName = fileNameKey.split('/').pop()

    console.log({ fileName, campaignId })

    const audioRecord = await dynamodb.get({
      TableName: TABLE_NAME,
      Key: {
          Id: fileName,
          METADATA: `AUDIO#${campaignId}`
      }
    }).promise();

    if (!audioRecord.Item) {
      return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Audio non trouvé' })
      };
    }

    console.log('Audio de lechange segmente dans la base de données :', audioRecord.Item);
    await dynamodb.update({
      TableName: TABLE_NAME,
      Key: {
        Id: fileName,
        METADATA: `AUDIO#${campaignId}`,
      },
      UpdateExpression: 'SET dialogue_segments_cleaned = :dsc',
      ExpressionAttributeValues: {
        ':dsc': dialogue_segments_cleaned
      }
    }).promise();


    const transcriptText = transcriptJson.results?.transcripts?.[0]?.transcript || '';
    console.log('Texte extrait du transcript :', transcriptText);
    if (!key.endsWith('.json')) {
      return {
        ignored: true,
        key: key,
        jobName: jobName,
        bucket

      };
    }
    return {
      ignored: false,
      transcriptText: transcriptText,
      jobName: jobName,
      bucket,
      key,
      fileNameKey,
      campaign_type: audioRecord.Item.campaign_type
    };
  } catch (err) {
    console.error('Erreur lors de la récupération ou du parsing du transcript :', err);
    throw err;
  }
};
