const AWS = require('aws-sdk');
const comprehend = new AWS.Comprehend();

function splitTextByBytes(text, maxBytes = 4500) {
    const chunks = [];
    let current = '';
    for (const char of text) {
        if (Buffer.byteLength(current + char, 'utf8') > maxBytes) {
            chunks.push(current);
            current = '';
        }
        current += char;
    }
    if (current) chunks.push(current);
    return chunks;
}

exports.handler = async (event) => {
    console.log('Event reçu:', JSON.stringify(event));
    const transcriptText = event.transcriptText;

    if (!transcriptText) {
        throw new Error('Le texte de transcription est requis');
    }

    try {
        // Découper le texte en morceaux de 5000 bytes max
        const chunks = splitTextByBytes(transcriptText, 5000);

        // Analyse chaque chunk séparément
        const results = await Promise.all(
            chunks.map(chunk =>
                comprehend.detectSentiment({ Text: chunk, LanguageCode: 'fr' }).promise()
            )
        );

        const mainSentiment = results[0].Sentiment;
        const avgScore = results.reduce((acc, r) => {
            acc.Positive += r.SentimentScore.Positive;
            acc.Negative += r.SentimentScore.Negative;
            acc.Neutral += r.SentimentScore.Neutral;
            acc.Mixed += r.SentimentScore.Mixed;
            return acc;
        }, { Positive: 0, Negative: 0, Neutral: 0, Mixed: 0 });
        Object.keys(avgScore).forEach(k => avgScore[k] /= results.length);

        const analysis = {
            sentiment: {
                overall: mainSentiment,
                scores: avgScore
            }
        };

        return {
            originalText: transcriptText,
            analysis,
            fileNameKey: event.fileNameKey,
            campaign_type: event.campaign_type
        };

    } catch (error) {
        console.error('Erreur lors de l\'analyse:', error);
        throw error;
    }
};