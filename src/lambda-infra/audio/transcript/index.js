const { TranscribeService } = require('aws-sdk');

exports.handler = async (event) => {
  console.log(event)
  const transcribe = new TranscribeService();
  // Extraction des infos S3 depuis l'event Step Function (format S3 Event Notification)
  if (!event.Records || !event.Records[0] || !event.Records[0].s3) {
    throw new Error('Format d\'entrée inattendu : event.Records[0].s3 manquant');
  }
  const bucket = event.Records[0].s3.bucket.name;
  const key = event.Records[0].s3.object.key;

  if (!bucket || !key) {
    throw new Error('Paramètres manquants : bucket et key sont requis dans l\'event');
  }

  if (key.startsWith('.') || !key.match(/\.(wav|mp3|mp4|flac|ogg|m4a)$/i)) {
    console.log(`Fichier ignoré (non audio ou temporaire): ${key}`);
    return { ignored: true, key };
  }

  const campaignId = key.split('/')[0];
  const fileName = key.split('/').pop().replace(/\.[^/.]+$/, '.json');
  const outputKey = `${campaignId}/transcripts/${fileName}`;

  const jobName = `transcription-${Date.now()}-${Buffer.from(key).toString('base64').slice(0, 8)}`;
  const params = {
    TranscriptionJobName: jobName,
    LanguageCode: 'fr-FR',
    Media: {
      MediaFileUri: `s3://${bucket}/${key}`
    },
    OutputBucketName: bucket,
    OutputKey: outputKey,
    Settings: {
      ShowSpeakerLabels: true,
      MaxSpeakerLabels: 3
    }
  };

  await transcribe.startTranscriptionJob(params).promise();
  console.log(`Transcription lancée pour ${key} (job: ${jobName})`);
  return { jobName, outputKey, bucket, key };
};