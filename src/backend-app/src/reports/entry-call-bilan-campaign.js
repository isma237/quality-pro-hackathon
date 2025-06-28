const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const { invokeBedrockWithClaude } = require('./lib');

exports.handler = async (event) => {
    console.log('Event reçu:', JSON.stringify(event));

    // Configuration CORS pour les réponses
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
    };
    
    // Gestion des requêtes OPTIONS pour CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: headers,
            body: ''
        };
    }

    try {
        const campaignId = event.pathParameters.campaignId;
        console.log(`Analyse de campagne d'appels entrants pour : ${campaignId}`);

        const campaignParams = {
            TableName: process.env.TABLE_NAME,
            Key: {
                Id: campaignId,
                METADATA: `CAMPAIGN#${campaignId}`,
            }
        };
        
        const campaignResult = await dynamoDB.get(campaignParams).promise();
        
        if (!campaignResult.Item) {
            return {
                statusCode: 404,
                headers: headers,
                body: JSON.stringify({ message: 'Campagne non trouvée' })
            };
        }
        
        const campaign = campaignResult.Item;
        console.log(`Campagne trouvée - Type: ${campaign.campaign_type}, Nom: ${campaign.name}`);
        
        // Requête DynamoDB pour récupérer tous les audios de la campagne
        const audioParams = {
            TableName: process.env.TABLE_NAME,
            KeyConditionExpression: 'METADATA = :metadata',
            FilterExpression: 'analysisStatus = :status',
            ExpressionAttributeValues: {
                ':metadata': `AUDIO#${campaignId}`,
                ':status': 'COMPLETE'
            },
            IndexName: 'MetadataIndex'
        };
        const result = await dynamoDB.query(audioParams).promise();

        if (!result.Items || result.Items.length === 0) {
            return {
                statusCode: 404,
                headers: headers,
                body: JSON.stringify({ message: 'Aucun audio trouvé pour cette campagne' })
            };
        }
        
        // Extraire et analyser les données
        const kpis = await analyzeEntryCallCampaign(result.Items);

        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({
                message: 'Analyse de la campagne effectuée avec succès',
                data: kpis
            })
        };

    } catch (error) {
        console.error('Erreur lors de l\'analyse de la campagne:', error);
        return {
            statusCode: 500,
            headers: headers,
            body: JSON.stringify({ message: 'Erreur interne du serveur' })
        };
    }
};

/**
 * Analyser les KPIs d'une campagne d'appels entrants
 * @param {Array} audioItems - Liste des audios avec leur analyse
 * @returns {Object} - Indicateurs principaux de la campagne
 */
async function analyzeEntryCallCampaign(audioItems) {
    if (!audioItems || !audioItems.length) {
        return { error: 'Aucune donnée à analyser' };
    }

    // 1. Sentiment analysis global
    const sentimentDistribution = analyzeSentiment(audioItems);
    
    // 2. Sujets principaux des appels
    const topSubjects = await extractTopSubjects(audioItems);
    
    // 3. Statut de résolution
    const resolutionStatus = analyzeResolutionStatus(audioItems);
    
    // 4. Qualité de l'interaction
    const qualityMetrics = analyzeQualityMetrics(audioItems);
    
    // 5. Actions et améliorations
    const actionItems = await extractActionItems(audioItems);

    return {
        totalCalls: audioItems.length,
        sentimentDistribution,
        topSubjects,
        resolutionStatus,
        qualityMetrics,
        actionItems
    };
}

/**
 * Analyser la distribution des sentiments
 */
function analyzeSentiment(audioItems) {
    const sentiments = {
        POSITIVE: 0,
        NEGATIVE: 0,
        NEUTRAL: 0,
        MIXED: 0
    };
    
    let totalPositiveScore = 0;
    let totalNegativeScore = 0;
    let totalNeutralScore = 0;
    
    audioItems.forEach(item => {
        const sentiment = item.analysisOutput?.sentiment?.overall || 'NEUTRAL';
        sentiments[sentiment] = (sentiments[sentiment] || 0) + 1;
        
        // Agréger les scores de sentiment
        if (item.analysisOutput?.sentiment?.scores) {
            const scores = item.analysisOutput.sentiment.scores;
            totalPositiveScore += scores.Positive || 0;
            totalNegativeScore += scores.Negative || 0;
            totalNeutralScore += scores.Neutral || 0;
        }
    });
    
    // Calculer les pourcentages
    const total = audioItems.length;
    const averagePositive = totalPositiveScore / total;
    const averageNegative = totalNegativeScore / total;
    const averageNeutral = totalNeutralScore / total;
    
    return {
        distribution: {
            positive: sentiments.POSITIVE,
            negative: sentiments.NEGATIVE,
            neutral: sentiments.NEUTRAL,
            mixed: sentiments.MIXED
        },
        percentages: {
            positive: parseFloat(((sentiments.POSITIVE / total) * 100).toFixed(1)),
            negative: parseFloat(((sentiments.NEGATIVE / total) * 100).toFixed(1)),
            neutral: parseFloat(((sentiments.NEUTRAL / total) * 100).toFixed(1)),
            mixed: parseFloat(((sentiments.MIXED / total) * 100).toFixed(1))
        },
        averageScores: {
            positive: parseFloat((averagePositive * 100).toFixed(1)),
            negative: parseFloat((averageNegative * 100).toFixed(1)),
            neutral: parseFloat((averageNeutral * 100).toFixed(1))
        }
    };
}

/**
 * Extraire les sujets principaux et produits mentionnés
 */
async function extractTopSubjects(audioItems) {
    const subjects = {};
    const problems = [];
    
    // Collecter les sujets et problèmes
    audioItems.forEach(item => {
        const subject = item.bedrockResult?.prompt_identification_sujet;
        if (subject) {
            subjects[subject] = (subjects[subject] || 0) + 1;
        }
        
        const problem = item.bedrockResult?.prompt_probleme_client;
        if (problem) {
            problems.push(problem);
        }
    });
    
    // Identifier si nous avons suffisamment d'éléments pour une consolidation
    if (Object.keys(subjects).length >= 5) {
        try {
            // Prompt amélioré pour normaliser et consolider les sujets
            const prompt = `
                [Tu es un expert en analyse de données de centres d'appels]
                
                Analyse et consolide ces sujets d'appels clients qui sont actuellement trop fragmentés :
                
                ${JSON.stringify(Object.entries(subjects).map(([subject, count]) => ({subject, count})))}
                
                Instructions spécifiques:
                1. Regroupe les sujets similaires sous une étiquette commune (ex: "Forfait internet" et "Problème de connexion Internet" → "Problèmes internet")
                2. IGNORE COMPLÈTEMENT tous les messages d'erreur comme "Je suis désolé", "Impossible de déterminer", "Aucun texte"
                3. Normalise les variations mineures (ex: "Transfert de crédit"/"Transfert d'argent"/"Transfert Orange Money" → "Transferts monétaires")
                4. Limite la liste aux 10 catégories principales maximum
                5. Utilise des termes concis et précis
                6. Additionne les compteurs lors du regroupement
                
                Réponds UNIQUEMENT au format JSON suivant:
                {
                  "topSubjects": [
                    {"name": "Catégorie normalisée", "count": nombre_total_dans_categorie},
                    ...
                  ]
                }
            `;
            
            const response = await invokeBedrockWithClaude(prompt, null, 'subject-consolidation');
            
            try {
                const result = JSON.parse(response);
                // Assurer que les résultats sont triés par nombre d'occurrences décroissant
                if (result.topSubjects) {
                    result.topSubjects.sort((a, b) => b.count - a.count);
                }
                return result;
            } catch (e) {
                console.warn("Erreur lors du parsing de la réponse consolidée:", e);
                return { topSubjects: convertToSortedArray(subjects).slice(0, 10) };
            }
        } catch (error) {
            console.error("Erreur lors de la consolidation des sujets:", error);
            return { topSubjects: convertToSortedArray(subjects).slice(0, 10) };
        }
    } else {
        // Si trop peu de sujets, simplement trier et retourner
        return { topSubjects: convertToSortedArray(subjects) };
    }
}

/**
 * Analyser les statuts de résolution
 */
function analyzeResolutionStatus(audioItems) {
    const statuses = {
        resolved: 0,
        unresolved: 0,
        partiallyResolved: 0
    };
    
    const callbackRequired = {
        yes: 0,
        no: 0
    };
    
    audioItems.forEach(item => {
        // Analyser le statut de résolution
        const resolution = item.bedrockResult?.prompt_statut_resolution || '';
        if (resolution.toLowerCase().includes('oui')) {
            statuses.resolved++;
        } else if (resolution.toLowerCase().includes('partiellement')) {
            statuses.partiallyResolved++;
        } else {
            statuses.unresolved++;
        }
        
        // Besoin de rappel
        const callback = item.bedrockResult?.prompt_necessite_rappel || '';
        if (callback.toLowerCase().includes('oui')) {
            callbackRequired.yes++;
        } else {
            callbackRequired.no++;
        }
    });
    
    const total = audioItems.length;
    
    return {
        resolution: {
            resolved: statuses.resolved,
            partiallyResolved: statuses.partiallyResolved,
            unresolved: statuses.unresolved,
            percentages: {
                resolved: parseFloat(((statuses.resolved / total) * 100).toFixed(1)),
                partiallyResolved: parseFloat(((statuses.partiallyResolved / total) * 100).toFixed(1)),
                unresolved: parseFloat(((statuses.unresolved / total) * 100).toFixed(1))
            }
        },
        callbackRequired: {
            yes: callbackRequired.yes,
            no: callbackRequired.no,
            percentage: parseFloat(((callbackRequired.yes / total) * 100).toFixed(1))
        }
    };
}

/**
 * Analyser les métriques de qualité
 */
function analyzeQualityMetrics(audioItems) {
    let totalScore = 0;
    let validScores = 0;
    let politenessGood = 0;
    let clarityGood = 0;
    let callsTooLong = 0;
    let repetitionsDetected = 0;
    
    audioItems.forEach(item => {
        try {
            // Extraire les données du bilan global s'il est en format JSON
            let bilanGlobal = {};
            if (item.bedrockResult?.prompt_bilan_global) {
                try {
                    bilanGlobal = JSON.parse(item.bedrockResult.prompt_bilan_global);
                } catch (e) {
                    // Ignorer l'erreur de parsing
                }
            }
            
            // Score global
            if (bilanGlobal.scoreglobalsur_10) {
                totalScore += parseFloat(bilanGlobal.scoreglobalsur_10);
                validScores++;
            }
            
            // Politesse de l'agent
            const politeness = item.bedrockResult?.prompt_evaluation_politesse || '';
            if (politeness.toLowerCase().includes('oui')) {
                politenessGood++;
            }
            
            // Clarté de la communication
            if (bilanGlobal.clarte_concision && bilanGlobal.clarte_concision.valeur === true) {
                clarityGood++;
            }
            
            // Appel trop long
            if (bilanGlobal.appeltroplong && bilanGlobal.appeltroplong.valeur === true) {
                callsTooLong++;
            }
            
            // Répétitions détectées
            if (bilanGlobal.repetitions_detectees && bilanGlobal.repetitions_detectees.valeur === true) {
                repetitionsDetected++;
            }
            
        } catch (error) {
            console.warn('Erreur lors de l\'analyse des métriques de qualité:', error);
        }
    });
    
    const total = audioItems.length;
    const averageScore = validScores > 0 ? totalScore / validScores : 0;
    
    return {
        averageQualityScore: parseFloat(averageScore.toFixed(1)),
        politeness: {
            good: politenessGood,
            percentage: parseFloat(((politenessGood / total) * 100).toFixed(1))
        },
        clarity: {
            good: clarityGood,
            percentage: parseFloat(((clarityGood / total) * 100).toFixed(1))
        },
        callsTooLong: {
            count: callsTooLong,
            percentage: parseFloat(((callsTooLong / total) * 100).toFixed(1))
        },
        repetitionsDetected: {
            count: repetitionsDetected,
            percentage: parseFloat(((repetitionsDetected / total) * 100).toFixed(1))
        }
    };
}

/**
 * Extraire les actions et recommandations via Bedrock/Claude
 */
async function extractActionItems(audioItems) {
    // Regrouper les données pour l'analyse
    const actionsData = audioItems.map(item => ({
        actions: item.bedrockResult?.prompt_actions_agent || '',
        bilan: item.bedrockResult?.prompt_bilan_global || ''
    }));
    
    try {
        // Prompt amélioré avec format de réponse explicite et structure alignée
        const prompt = `
            [Tu es un expert en analyse de centres d'appel] 

            Analyse ces données d'appels clients et extrais:
            1. Les 5 suggestions d'amélioration les plus importantes
            2. Les 10 actions d'agents les plus communes

            IMPORTANT: Tu DOIS respecter EXACTEMENT le format JSON suivant:
            {
              "topImprovement": [
                {"name": "suggestion d'amélioration", "count": nombre_occurrences},
                ...
              ],
              "commonAgentActions": [
                {"name": "action agent", "count": nombre_occurrences},
                ...
              ]
            }

            Ce format est critique pour la compatibilité avec le système existant.
        `;
        
        const response = await invokeBedrockWithClaude(actionsData, prompt, 'action-items-extraction');

        try {
            // Parsing et validation de la structure
            const result = JSON.parse(response);
            
            // Vérifier que la structure est correcte
            if (!Array.isArray(result.topImprovement) || !Array.isArray(result.commonAgentActions)) {
                throw new Error("Format de réponse incorrect");
            }
            
            // Assurer le tri des résultats
            result.topImprovement.sort((a, b) => b.count - a.count);
            result.commonAgentActions.sort((a, b) => b.count - a.count);
            
            return {
                topImprovement: result.topImprovement || [],
                commonAgentActions: result.commonAgentActions || []
            };
        } catch (e) {
            console.warn("Erreur de parsing ou format incorrect:", e);
            
            // Tenter de reformater la réponse si elle suit le format alternatif
            try {
                const altResult = JSON.parse(response);
                if (altResult.suggestions_amelioration && altResult.actions_agents) {
                    // Convertir au format attendu
                    const topImprovement = altResult.suggestions_amelioration.map(item => ({
                        name: item.suggestion,
                        count: item.occurrences
                    }));
                    
                    const commonAgentActions = altResult.actions_agents.map(item => ({
                        name: item.action,
                        count: item.occurrences
                    }));
                    
                    // Trier les résultats convertis
                    topImprovement.sort((a, b) => b.count - a.count);
                    commonAgentActions.sort((a, b) => b.count - a.count);
                    
                    return {
                        topImprovement,
                        commonAgentActions
                    };
                }
            } catch (altError) {
                // Ignorer cette seconde tentative si elle échoue
            }
            
            // Fallback au traitement local si les deux tentatives échouent
            return extractActionItemsLocally(audioItems);
        }
    } catch (error) {
        console.error("Erreur lors de l'appel à Bedrock:", error);
        return extractActionItemsLocally(audioItems);
    }
}

/**
 * Extraire les produits mentionnés via Bedrock/Claude
 */
async function extractProducts(audioItems) {
    // Regrouper les données pour l'analyse
    const productsData = audioItems.map(item => ({
        productHtml: item.bedrockResult?.prompt_identification_produit || '',
        subject: item.bedrockResult?.prompt_identification_sujet || ''
    }));
        
    try {
        // Requête Bedrock pour une analyse plus sophistiquée
        const prompt = `
            [Tu es un expert en analyse linguistique et sémantique pour les centres d'appels] Analyse ces données d'identification de produits dans des appels clients.
            Extrait et normalise les noms des produits ou services mentionnés.
            Regroupe les produits similaires sous un même label.
            Réponds uniquement avec un JSON contenant la liste des produits et leur fréquence :
            
            {
              "products": [
                {"name": "nom_produit", "count": nombre_occurrences},
                ...
              ]
            }
        `;

        const response = await invokeBedrockWithClaude(productsData, prompt, 'entry-call-bilan');

        try {
            const result = JSON.parse(response);
            return {
                topProducts: result.products || []
            };
        } catch (e) {
            console.warn("Erreur de parsing de la réponse Bedrock:", e);
            // Fallback au traitement local
            return {
                topProducts: convertToSortedArray(
                    productsData.map(data => extractProductFromHtml(data.productHtml))
                    .filter(Boolean)
                    .reduce((acc, product) => {
                        acc[product] = (acc[product] || 0) + 1;
                        return acc;
                    }, {})
                )
            };
        }
    } catch (error) {
        console.error("Erreur lors de l'appel à Bedrock:", error);
        // Fallback au traitement local
        return extractTopSubjectsLocally(audioItems);
    }
}

async function extractKeywords(problemTexts) {
    // Si c'est un seul texte, le convertir en tableau
    if (typeof problemTexts === 'string') {
        return extractKeywordsLocally(problemTexts);
    }
    
    try {
        // Requête Bedrock pour une analyse plus sophistiquée
        const prompt = `
            [Tu es un expert en analyse linguistique et sémantique pour les centres d'appels]
            
            Analyse les problèmes clients suivants et extrais les mots-clés les plus importants.
            Identifie les termes récurrents et significatifs qui caractérisent les problèmes.
            Ne conserve que les termes importants pour comprendre le contexte des problèmes.
            
            Normalise les mots-clés similaires (pluriel/singulier, synonymes proches).
            Pour chaque terme, calcule sa fréquence.
            
            Réponds uniquement avec un JSON au format suivant:
            
            {
              "keywords": [
                {"term": "mot_clé", "count": nombre_occurrences},
                ...
              ]
            }
            Problèmes clients: 
        `;

        const response = await invokeBedrockWithClaude(problemTexts, prompt, 'entry-call-bilan');

        try {
            const result = JSON.parse(response);
            return result.keywords || [];
        } catch (e) {
            console.warn("Erreur de parsing de la réponse Bedrock:", e);
            // Fallback au traitement local
            return problemTexts.flatMap(text => extractKeywordsLocally(text));
        }
    } catch (error) {
        console.error("Erreur lors de l'appel à Bedrock:", error);
        // Fallback au traitement local
        return problemTexts.flatMap(text => extractKeywordsLocally(text));
    }
}

/**
 * Extraire les actions et recommandations
 */
function extractActionItemsLocally(audioItems) {
    const suggestions = {};
    const agentActions = new Set();
    
    audioItems.forEach(item => {
        try {
            // Extraire les suggestions d'amélioration
            let bilanGlobal = {};
            if (item.bedrockResult?.prompt_bilan_global) {
                try {
                    bilanGlobal = JSON.parse(item.bedrockResult.prompt_bilan_global);
                    
                    // Comptabiliser les suggestions d'amélioration
                    if (Array.isArray(bilanGlobal.suggestions_amelioration)) {
                        bilanGlobal.suggestions_amelioration.forEach(suggestion => {
                            suggestions[suggestion] = (suggestions[suggestion] || 0) + 1;
                        });
                    }
                } catch (e) {
                    // Ignorer l'erreur de parsing
                }
            }
            
            // Extraire les actions des agents (pour analyser les patterns)
            const actionText = item.bedrockResult?.prompt_actions_agent || '';
            if (actionText) {
                // Extraire les éléments de liste (<li>) 
                const actionMatches = actionText.match(/<li>(.*?)<\/li>/g);
                if (actionMatches) {
                    actionMatches.forEach(match => {
                        const action = match.replace(/<\/?li>/g, '').trim();
                        agentActions.add(action);
                    });
                }
            }
            
        } catch (error) {
            console.warn('Erreur lors de l\'extraction des actions:', error);
        }
    });
    
    return {
        topImprovement: convertToSortedArray(suggestions).slice(0, 5), // Top 5 suggestions
        commonAgentActions: Array.from(agentActions).slice(0, 10)  // Top 10 actions
    };
}

// Fonctions utilitaires

/**
 * Extraire le produit depuis une chaîne HTML
 */
function extractTopSubjectsLocally(html) {
    if (!html) return '';
    
    // Rechercher le texte en surbrillance
    const match = html.match(/<strong[^>]*>(.*?)<\/strong>/);
    if (match) {
        return match[1].replace(/style="background-color: #[a-z0-9]+"/, '').trim();
    }
    
    // Si pas de balise strong, extraire le premier élément de liste
    const listMatch = html.match(/<li>(.*?)<\/li>/);
    if (listMatch) {
        return listMatch[1].trim();
    }
    
    // Sinon retourner les premiers mots
    return html.replace(/<[^>]*>/g, '').trim().split(' ').slice(0, 3).join(' ');
}

/**
 * Extraire les mots-clés d'un texte
 */
function extractKeywordsLocally(text) {
    if (!text) return [];
    
    // Nettoyer le texte
    const cleanText = text
        .replace(/[.,;:"'()\[\]{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase();
    
    // Filtrer les mots courants
    const stopWords = ['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'ce', 'ces', 'et', 'ou', 'qui', 'que', 'quoi', 'dont', 'pour', 'dans', 'sur', 'par', 'avec', 'sans'];
    
    cleanText
        .split(' ')
        .filter(word => word.length > 2 && !stopWords.includes(word))
        .forEach(word => {
            wordCount[word] = (wordCount[word] || 0) + 1;
        });

    return convertToSortedArray(wordCount);

}

/**
 * Convertir un objet de comptage en tableau trié
 */
function convertToSortedArray(countObject) {
    return Object.entries(countObject)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
}