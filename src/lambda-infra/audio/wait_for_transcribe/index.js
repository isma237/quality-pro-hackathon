const { TranscribeService } = require('aws-sdk');

exports.handler = async (event) => {
  const transcribe = new TranscribeService();
  const jobName = event.jobName;
  const bucket = event.bucket;
  const outputKey = event.outputKey;
  if (!jobName) {
    throw new Error('jobName manquant dans l\'entrée');
  }
  const data = await transcribe.getTranscriptionJob({ TranscriptionJobName: jobName }).promise();
  const status = data.TranscriptionJob.TranscriptionJobStatus;
  return {
    jobName,
    bucket,
    outputKey,
    status,
    key: event.key,
    transcriptFileUri: data.TranscriptionJob.Transcript ? data.TranscriptionJob.Transcript.TranscriptFileUri : null
  };
};
