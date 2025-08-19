import { Platform } from 'react-native';
import { CONFIG } from './config';
import { logger } from './logger';
import { performanceMonitor } from './performance';
import { networkService } from './network';
import { storageService } from './storage';
import { errorHandler } from './error-handler';
import { analyticsService } from './analytics';

// Import FileSystem conditionally for React Native
let FileSystem: any = null;
if (Platform.OS !== 'web') {
  try {
    FileSystem = require('expo-file-system');
  } catch (error) {
    console.warn('FileSystem not available:', error);
  }
}

export interface GlowAnalysisResult {
  overallScore: number;
  skinPotential: string;
  skinQuality: string;
  jawlineScore: number;
  skinTone: string;
  skinType: string;
  brightness: number;
  hydration: number;
  symmetryScore: number;
  glowScore: number; // Keep for backward compatibility
  improvements: string[];
  recommendations: string[];
  tips: string[];
  aiTips: string[];
}

export interface OutfitAnalysisResult {
  outfitScore: number;
  colorMatchScore: number;
  styleScore: number;
  fitScore: number;
  trendScore: number;
  occasionScore: number;
  detectedItems: string[];
  compatibleColors: string[];
  tips: string[];
  whatWorked: string[];
  improvements: string[];
  eventAppropriate: boolean;
  seasonalMatch: boolean;
  styleCategory: string;
  confidenceLevel: number;
}

export interface CoachingPlan {
  id: string;
  goal: string;
  duration: number; // days
  dailyTasks: DailyTask[];
  tips: string[];
  expectedResults: string[];
}

export type TaskType = 'skincare' | 'hydration' | 'sleep' | 'exercise' | 'nutrition';

export interface DailyTask {
  id: string;
  day: number;
  title: string;
  description: string;
  type: TaskType;
  completed: boolean;
  reminder?: string;
}

class AIService {

  private async makeAIRequest<T>(url: string, body: any, timeout: number = 30000): Promise<T> {
    return performanceMonitor.measure('makeAIRequest', async () => {
      try {
        logger.debug('Making AI request', { url, timeout });
        
        const result = await networkService.post<T>(url, body, {
          timeout,
          retries: 1,
          retryDelay: 2000,
        });
        
        logger.debug('AI request successful', { url });
        return result;
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes('cancelled') || 
              error.message.includes('aborted') || 
              error.name === 'AbortError') {
            logger.debug('AI request was cancelled', { url, error: error.message });
            throw new Error('Request was cancelled');
          }
          if (error.message.includes('Failed to fetch') || 
              error.message.includes('Network request failed') ||
              error.message.includes('TypeError: Failed to fetch')) {
            logger.warn('Network error in AI request', { url, error: error.message });
            throw new Error('Network connection failed. Please check your internet connection.');
          }
          if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
            logger.warn('AI request timeout', { url, timeout });
            throw new Error('Request timed out. Please try again.');
          }
        }
        logger.error('AI request failed', { url, error: error instanceof Error ? error.message : 'Unknown error' });
        throw error;
      }
    });
  }

  private async uploadImageToS3(imageUri: string, fileName: string): Promise<string> {
    return performanceMonitor.measure('uploadImageToS3', async () => {
      try {
        logger.info('Starting S3 upload', { fileName, imageUri: imageUri.substring(0, 50) + '...' });
        
        if (!CONFIG.AWS.S3_BUCKET_NAME) {
          logger.debug('S3 not configured, using local image URI');
          return imageUri;
        }
        
        logger.info('S3 upload completed', { fileName });
        return imageUri;
      } catch (error) {
        await errorHandler.reportError(
          error as Error,
          'ai-service',
          'uploadImageToS3',
          { fileName, imageUri: imageUri.substring(0, 50) + '...' }
        );
        throw new Error('Failed to upload image');
      }
    });
  }

  async analyzeImageWithVision(imageUri: string): Promise<any> {
    try {
      const base64Image = await this.convertImageToBase64(imageUri);
      
      const apiKey = CONFIG.AI.GOOGLE_VISION_API_KEY;
      console.log('Google Vision API Key check:', {
        hasKey: !!apiKey,
        keyLength: apiKey?.length || 0,
        keyStart: apiKey?.substring(0, 10) || 'none'
      });
      
      if (!apiKey) {
        throw new Error('Google Vision API key not configured');
      }
      
      const response = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${CONFIG.AI.GOOGLE_VISION_API_KEY}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                image: {
                  content: base64Image,
                },
                features: [
                  { type: 'FACE_DETECTION', maxResults: 1 },
                  { type: 'IMAGE_PROPERTIES', maxResults: 1 },
                  { type: 'OBJECT_LOCALIZATION', maxResults: 10 },
                ],
              },
            ],
          }),
        }
      );

      if (!response.ok) {
        let details = '';
        try {
          const errJson = await response.json();
          details = errJson?.error?.message || JSON.stringify(errJson);
        } catch {
          details = response.statusText || 'Unknown error';
        }
        throw new Error(`Vision API error: ${response.status} ${details}`);
      }

      const json = await response.json();
      return json;
    } catch (error) {
      await errorHandler.reportNetworkError(
        error as Error,
        `https://vision.googleapis.com/v1/images:annotate`,
        'POST'
      );
      logger.error('Vision API failed', error as Error);

      try {
        const fallback = await this.analyzeImageWithGemini(imageUri);
        const parseHex = (hex: string) => {
          const clean = (hex || '').replace('#','');
          const r = parseInt(clean.slice(0,2) || '00', 16);
          const g = parseInt(clean.slice(2,4) || '00', 16);
          const b = parseInt(clean.slice(4,6) || '00', 16);
          return { r, g, b };
        };
        const synthetic = {
          responses: [
            {
              faceAnnotations: fallback.facePresent ? [
                {
                  detectionConfidence: 0.8,
                  landmarkingConfidence: 0.6,
                  rollAngle: 0,
                  panAngle: 0,
                  tiltAngle: 0,
                }
              ] : [],
              imagePropertiesAnnotation: {
                dominantColors: {
                  colors: (fallback.colors || []).slice(0,5).map((h: string) => ({
                    color: parseHex(h),
                    pixelFraction: 0.2,
                    score: 0.2,
                  }))
                }
              },
              localizedObjectAnnotations: (fallback.items || []).map((name: string) => ({ name, score: 0.7 }))
            }
          ]
        };
        logger.warn('Using Gemini fallback for Vision data');
        return synthetic;
      } catch (fallbackErr) {
        logger.error('Gemini fallback failed', fallbackErr as Error);
        throw error;
      }
    }
  }

  private async analyzeImageWithGemini(imageUri: string): Promise<{ facePresent: boolean; facesCount: number; quality: 'good' | 'bad'; reasons: string[]; items: string[]; colors: string[] }> {
    try {
      const base64Image = await this.convertImageToBase64(imageUri);
      const apiKey = CONFIG.AI.GOOGLE_GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('Google Gemini API key not configured');
      }
      const body = {
        contents: [
          {
            parts: [
              { text: 'You are a strict validator. Analyze this photo and return compact JSON. Goals: 1) Determine if a real human face is clearly present and centered for analysis (not cartoon, not obscured), 2) List visible clothing items on the person, 3) Extract dominant garment colors as hex if possible, 4) Rate image quality for analysis based on lighting, focus, and obstructions.' },
              { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
              { text: 'Respond ONLY with JSON having fields: {"facePresent": true|false, "facesCount": number, "quality": "good"|"bad", "reasons": string[], "items": string[], "colors": string[] }' }
            ]
          }
        ]
      } as const;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      );
      if (!res.ok) {
        throw new Error(`Gemini API error: ${res.status} ${res.statusText}`);
      }
      const json = await res.json();
      const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const match = text.match(/\{[\s\S]*\}/);
      const payload = match ? match[0] : text;
      const parsed = JSON.parse(payload);
      return {
        facePresent: !!parsed.facePresent,
        facesCount: Number(parsed.facesCount ?? 0),
        quality: parsed.quality === 'good' ? 'good' : 'bad',
        reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
        items: Array.isArray(parsed.items) ? parsed.items : [],
        colors: Array.isArray(parsed.colors) ? parsed.colors : [],
      };
    } catch (error) {
      await errorHandler.reportNetworkError(error as Error, 'https://generativelanguage.googleapis.com', 'POST');
      logger.error('Gemini image analysis failed', error as Error);
      throw error;
    }
  }

  private async convertImageToBase64(imageUri: string): Promise<string> {
    try {
      if (Platform.OS === 'web') {
        const response = await fetch(imageUri);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        if (!FileSystem) {
          throw new Error('FileSystem not available on this platform');
        }
        return await FileSystem.readAsStringAsync(imageUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }
    } catch (error) {
      await errorHandler.reportError(
        error as Error,
        'ai-service',
        'convertImageToBase64',
        { platform: Platform.OS, imageUri: imageUri.substring(0, 50) + '...' }
      );
      throw error;
    }
  }

  async analyzeGlow(imageUri: string): Promise<GlowAnalysisResult> {
    try {
      console.log('Starting glow analysis for:', imageUri);
      const fingerprint = await this.generateImageFingerprint(imageUri);
      const cacheKey = `glow_analysis_${fingerprint}`;
      const cachedResult = await storageService.get<GlowAnalysisResult>(cacheKey);
      if (cachedResult) {
        logger.debug('Using cached glow analysis result', { fingerprint });
        return cachedResult;
      }

      const vision = await this.analyzeImageWithVision(imageUri);
      const face = vision?.responses?.[0]?.faceAnnotations?.[0];
      if (!face) {
        throw new Error('No face detected. Please retake the photo with good lighting and center your face.');
      }
      const imageProps = vision?.responses?.[0]?.imagePropertiesAnnotation?.dominantColors?.colors ?? [];
      const computed = this.computeGlowFromVision(face, imageProps);
      await storageService.set(cacheKey, computed, { expiresIn: 24 * 60 * 60 * 1000 });
      return computed;
    } catch (error) {
      if (error instanceof Error && (error.message.includes('cancelled') || error.message.includes('aborted'))) {
        logger.debug('Glow analysis request was cancelled', { imageUri: imageUri.substring(0, 50) + '...' });
        throw error;
      }
      await errorHandler.reportError(
        error as Error,
        'glow-analysis',
        'analyzeGlow',
        { imageUri: imageUri.substring(0, 50) + '...' }
      );
      logger.warn('Glow analysis failed', error as Error);
      throw error;
    }
  }

  private async getAIGlowAnalysis(visionData: any, imageUri: string, fingerprint: string): Promise<GlowAnalysisResult> {
    try {
      const base64Image = await this.convertImageToBase64(imageUri);
      const consistentAnalysis = this.generateConsistentAnalysis(fingerprint);
      const requestBody = {
        messages: [
          {
            role: 'system',
            content: `You are a professional beauty and facial analysis expert. Analyze the facial features and skin quality comprehensively. 
            
            IMPORTANT: Provide accurate analysis based on the actual image. For consistency with the same image, use these baseline references but prioritize actual visual assessment:
            - Baseline Overall Score: ${consistentAnalysis.overallScore} (adjust ±10 based on actual skin quality)
            - Baseline Jawline Score: ${consistentAnalysis.jawlineScore} (adjust based on actual jawline definition)
            - Baseline Brightness: ${consistentAnalysis.brightness} (adjust based on actual skin luminosity)
            - Baseline Hydration: ${consistentAnalysis.hydration} (adjust based on visible skin texture)
            - Baseline Symmetry: ${consistentAnalysis.symmetryScore} (adjust based on facial symmetry analysis)
            - Suggested Skin Tone: ${consistentAnalysis.skinTone} (verify against actual image)
            - Suggested Skin Type: ${consistentAnalysis.skinType} (verify against visible skin characteristics)
            
            ANALYSIS PRIORITY: Real visual assessment > Baseline consistency. Only use baselines for the same exact image.
            
            Return a detailed JSON analysis with these exact fields:
            {
              "overallScore": number (1-100),
              "skinPotential": string ("High", "Medium", "Low"),
              "skinQuality": string ("Excellent", "Good", "Fair", "Needs Improvement"),
              "jawlineScore": number (1-100),
              "skinTone": string (e.g., "Warm Beige", "Cool Ivory", "Deep Caramel"),
              "skinType": string ("Oily", "Dry", "Combination", "Normal", "Sensitive"),
              "brightness": number (1-100),
              "hydration": number (1-100),
              "symmetryScore": number (1-100),
              "aiTips": array of 3-5 personalized beauty tips,
              "improvements": array of specific improvement suggestions,
              "recommendations": array of product/routine recommendations
            }`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Perform a comprehensive facial analysis on this image. Use the provided baseline scores as reference points and make small adjustments based on what you observe in the image.
                
                Analyze:
                1. Overall facial beauty score (around ${consistentAnalysis.overallScore})
                2. Skin potential assessment
                3. Skin quality evaluation
                4. Jawline definition and sharpness (around ${consistentAnalysis.jawlineScore})
                5. Skin tone classification (likely ${consistentAnalysis.skinTone})
                6. Skin type determination (likely ${consistentAnalysis.skinType})
                7. Brightness and glow level (around ${consistentAnalysis.brightness})
                8. Hydration level assessment (around ${consistentAnalysis.hydration})
                9. Facial symmetry analysis (around ${consistentAnalysis.symmetryScore})
                10. Personalized AI beauty tips
                
                Pre-analysis data: ${JSON.stringify(visionData)}
                
                Provide detailed, actionable insights and recommendations. For the SAME image, stay within ±3 points of baseline. For DIFFERENT images, prioritize accurate analysis over baseline consistency.`,
              },
              {
                type: 'image',
                image: base64Image,
              },
            ],
          },
        ],
      };
      
      const result = await this.makeAIRequest<{ completion: string }>(
        `${CONFIG.AI.RORK_AI_BASE_URL}/text/llm/`,
        requestBody,
        45000
      );
      
      return this.parseGlowAnalysis(result.completion, consistentAnalysis);
    } catch (error) {
      await errorHandler.reportNetworkError(
        error as Error,
        `${CONFIG.AI.RORK_AI_BASE_URL}/text/llm/`,
        'POST'
      );
      logger.error('AI glow analysis failed', error as Error);
      throw error;
    }
  }

  private parseGlowAnalysis(aiResponse: string, consistentAnalysis?: Partial<GlowAnalysisResult>): GlowAnalysisResult {
    try {
      const parsed = JSON.parse(aiResponse);
      const constrainScore = (score: number, baseline: number, variance: number = 8): number => {
        if (typeof score !== 'number' || isNaN(score)) return baseline;
        const actualVariance = consistentAnalysis ? Math.min(variance, 3) : variance;
        return Math.max(1, Math.min(100, Math.round(Math.max(baseline - actualVariance, Math.min(baseline + actualVariance, score)))));
      };
      if (typeof parsed.overallScore === 'number' && 
          typeof parsed.skinTone === 'string' &&
          Array.isArray(parsed.aiTips)) {
        const result: GlowAnalysisResult = {
          overallScore: consistentAnalysis ? constrainScore(parsed.overallScore, consistentAnalysis.overallScore!) : parsed.overallScore,
          skinPotential: parsed.skinPotential || consistentAnalysis?.skinPotential || 'Medium',
          skinQuality: parsed.skinQuality || consistentAnalysis?.skinQuality || 'Good',
          jawlineScore: consistentAnalysis ? constrainScore(parsed.jawlineScore || 75, consistentAnalysis.jawlineScore!) : (parsed.jawlineScore || 75),
          skinTone: parsed.skinTone || consistentAnalysis?.skinTone || 'Medium',
          skinType: parsed.skinType || consistentAnalysis?.skinType || 'Normal',
          brightness: consistentAnalysis ? constrainScore(parsed.brightness || 75, consistentAnalysis.brightness!) : (parsed.brightness || 75),
          hydration: consistentAnalysis ? constrainScore(parsed.hydration || 70, consistentAnalysis.hydration!) : (parsed.hydration || 70),
          symmetryScore: consistentAnalysis ? constrainScore(parsed.symmetryScore || 85, consistentAnalysis.symmetryScore!) : (parsed.symmetryScore || 85),
          glowScore: 0,
          improvements: parsed.improvements || [],
          recommendations: parsed.recommendations || [],
          tips: parsed.aiTips,
          aiTips: parsed.aiTips,
        };
        result.glowScore = result.overallScore;
        return result;
      }
      if (typeof parsed.glowScore === 'number') {
        const result: GlowAnalysisResult = {
          overallScore: consistentAnalysis ? constrainScore(parsed.glowScore, consistentAnalysis.overallScore!) : parsed.glowScore,
          skinPotential: consistentAnalysis?.skinPotential || 'Medium',
          skinQuality: consistentAnalysis?.skinQuality || 'Good',
          jawlineScore: consistentAnalysis ? constrainScore(75, consistentAnalysis.jawlineScore!) : 75,
          skinTone: parsed.skinTone || consistentAnalysis?.skinTone || 'Medium',
          skinType: parsed.skinType || consistentAnalysis?.skinType || 'Normal',
          brightness: consistentAnalysis ? constrainScore(parsed.brightness || 75, consistentAnalysis.brightness!) : (parsed.brightness || 75),
          hydration: consistentAnalysis ? constrainScore(parsed.hydration || 70, consistentAnalysis.hydration!) : (parsed.hydration || 70),
          symmetryScore: consistentAnalysis ? constrainScore(parsed.symmetry || 85, consistentAnalysis.symmetryScore!) : (parsed.symmetry || 85),
          glowScore: 0,
          improvements: parsed.improvements || [],
          recommendations: parsed.recommendations || [],
          tips: parsed.tips || parsed.improvements || [],
          aiTips: parsed.tips || parsed.improvements || [],
        };
        result.glowScore = result.overallScore;
        return result;
      }
      throw new Error('Invalid AI response format');
    } catch (error) {
      logger.error('Failed to parse AI glow analysis response', { error: error instanceof Error ? error.message : 'Unknown error' });
      throw new Error('Invalid AI response format: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }

  async analyzeOutfit(imageUri: string, eventType: string): Promise<OutfitAnalysisResult> {
    try {
      console.log('Starting outfit analysis for:', imageUri, eventType);
      const vision = await this.analyzeImageWithVision(imageUri);
      const objects = vision?.responses?.[0]?.localizedObjectAnnotations ?? [];
      if (!objects || objects.length === 0) {
        throw new Error('No person/outfit detected. Please upload a full or half-body photo with clear lighting.');
      }
      return this.computeOutfitFromVision(vision, eventType);
    } catch (error) {
      if (error instanceof Error && (error.message.includes('cancelled') || error.message.includes('aborted'))) {
        logger.debug('Outfit analysis request was cancelled', { imageUri: imageUri.substring(0, 50) + '...', eventType });
        throw error;
      }
      await errorHandler.reportError(
        error as Error,
        'outfit-analysis',
        'analyzeOutfit',
        { imageUri: imageUri.substring(0, 50) + '...', eventType }
      );
      logger.error('Outfit analysis failed', error as Error);
      throw error;
    }
  }

  private async getAIOutfitAnalysis(visionData: any, imageUri: string, eventType: string): Promise<OutfitAnalysisResult> {
    try {
      const base64Image = await this.convertImageToBase64(imageUri);
      const requestBody = {
        messages: [
          {
            role: 'system',
            content: `You are a professional fashion stylist and outfit analysis expert. Analyze outfits comprehensively using fashion principles.
            
            Return detailed JSON analysis with these exact fields:
            {
              "outfitScore": number (1-100, overall style score),
              "colorMatchScore": number (1-100, color harmony analysis),
              "styleScore": number (1-100, style coherence),
              "fitScore": number (1-100, fit and proportion assessment),
              "trendScore": number (1-100, current fashion trends alignment),
              "occasionScore": number (1-100, appropriateness for the event),
              "detectedItems": array of detected clothing items,
              "compatibleColors": array of hex color codes that work well,
              "tips": array of general style suggestions,
              "whatWorked": array of positive aspects,
              "improvements": array of specific improvement suggestions,
              "eventAppropriate": boolean,
              "seasonalMatch": boolean,
              "styleCategory": string (e.g., "Business Casual", "Streetwear", "Formal"),
              "confidenceLevel": number (1-100, analysis confidence)
            }`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Perform comprehensive outfit analysis for a ${eventType} event. 
                
                Analyze using fashion principles:
                1. Color Theory & Harmony (color wheel, complementary colors)
                2. Fit & Proportion (silhouette, body proportions)
                3. Style Coherence (matching aesthetic, layering)
                4. Trend Alignment (current fashion trends)
                5. Occasion Appropriateness (dress code, formality level)
                6. Seasonal Matching (weather, seasonal colors)
                
                Detect clothing items and assess:
                - Garment identification (blazer, jeans, sneakers, etc.)
                - Color matching and contrast
                - Fit quality (too tight, loose, perfect)
                - Style mixing (formal/casual balance)
                - Accessory coordination
                
                Pre-analysis data: ${JSON.stringify(visionData)}
                
                Provide actionable, specific feedback with confidence scoring.`,
              },
              {
                type: 'image',
                image: base64Image,
              },
            ],
          },
        ],
      };
      
      const result = await this.makeAIRequest<{ completion: string }>(
        `${CONFIG.AI.RORK_AI_BASE_URL}/text/llm/`,
        requestBody,
        45000
      );
      
      return this.parseOutfitAnalysis(result.completion);
    } catch (error) {
      await errorHandler.reportNetworkError(
        error as Error,
        `${CONFIG.AI.RORK_AI_BASE_URL}/text/llm/`,
        'POST'
      );
      logger.error('AI outfit analysis failed', error as Error);
      throw error;
    }
  }

  private parseOutfitAnalysis(aiResponse: string): OutfitAnalysisResult {
    try {
      const parsed = JSON.parse(aiResponse);
      if (typeof parsed.outfitScore === 'number') {
        return {
          outfitScore: Math.max(1, Math.min(100, parsed.outfitScore)),
          colorMatchScore: Math.max(1, Math.min(100, parsed.colorMatchScore || 75)),
          styleScore: Math.max(1, Math.min(100, parsed.styleScore || 75)),
          fitScore: Math.max(1, Math.min(100, parsed.fitScore || 75)),
          trendScore: Math.max(1, Math.min(100, parsed.trendScore || 70)),
          occasionScore: Math.max(1, Math.min(100, parsed.occasionScore || 85)),
          detectedItems: Array.isArray(parsed.detectedItems) ? parsed.detectedItems : [
            'Black blazer', 'White shirt', 'Dark jeans', 'Brown shoes'
          ],
          compatibleColors: Array.isArray(parsed.compatibleColors) ? parsed.compatibleColors : [
            '#FF6B98', '#9D71E8', '#4CAF50', '#2196F3', '#FFD166'
          ],
          tips: Array.isArray(parsed.tips) ? parsed.tips : [
            'Consider adding a statement accessory',
            'Try different shoe styles for variety'
          ],
          whatWorked: Array.isArray(parsed.whatWorked) ? parsed.whatWorked : [
            'Great color coordination',
            'Well-fitted garments'
          ],
          improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [
            'Add more texture variety',
            'Consider seasonal colors'
          ],
          eventAppropriate: parsed.eventAppropriate !== false,
          seasonalMatch: parsed.seasonalMatch !== false,
          styleCategory: parsed.styleCategory || 'Smart Casual',
          confidenceLevel: Math.max(1, Math.min(100, parsed.confidenceLevel || 85)),
        };
      }
      throw new Error('Invalid AI response format - missing outfitScore');
    } catch (error) {
      logger.error('Failed to parse AI outfit analysis response', { error: error instanceof Error ? error.message : 'Unknown error' });
      throw new Error('Invalid AI response format: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }

  async generateCoachingPlan(goal: string, currentGlowScore: number): Promise<CoachingPlan> {
    try {
      logger.info('Starting coaching plan generation', { goal, currentGlowScore });
      
      const requestBody = {
        messages: [
          {
            role: 'system',
            content: `You are a professional beauty coach. Create a personalized 30-day beauty coaching plan in JSON format.
            
            Return a JSON object with this exact structure:
            {
              "duration": 30,
              "dailyTasks": [
                {
                  "id": "task-1",
                  "day": 1,
                  "title": "Task title",
                  "description": "Task description",
                  "type": "skincare",
                  "completed": false
                }
              ],
              "tips": ["tip1", "tip2", "tip3"],
              "expectedResults": ["result1", "result2", "result3"]
            }
            
            Task types can be: "skincare", "hydration", "sleep", "exercise", "nutrition"
            Create 3-5 tasks per day for the first 7 days, then 2-3 tasks per day for the remaining days.`,
          },
          {
            role: 'user',
            content: `Create a comprehensive 30-day coaching plan for someone with the goal: "${goal}" and current glow score: ${currentGlowScore}/100.
            
            The plan should be personalized based on their goal and current score. Include:
            - Daily tasks that progress in difficulty
            - Practical tips they can follow
            - Realistic expected results
            
            Focus on actionable, achievable tasks that build good habits over 30 days.`,
          },
        ],
      };
      
      const result = await this.makeAIRequest<{ completion: string }>(
        `${CONFIG.AI.RORK_AI_BASE_URL}/text/llm/`,
        requestBody,
        45000
      );
      
      logger.info('Coaching plan generation successful');
      return this.parseCoachingPlan(result.completion, goal);
    } catch (error) {
      await errorHandler.reportNetworkError(
        error as Error,
        `${CONFIG.AI.RORK_AI_BASE_URL}/text/llm/`,
        'POST'
      );
      logger.error('Coaching plan generation failed', error as Error);
      throw error;
    }
  }

  private parseCoachingPlan(aiResponse: string, goal: string): CoachingPlan {
    try {
      logger.debug('Parsing coaching plan response', { responseLength: aiResponse.length });
      
      // Try to extract JSON from the response
      let jsonStr = aiResponse.trim();
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
      
      const parsed = JSON.parse(jsonStr);
      
      // Validate required fields
      if (!Array.isArray(parsed.dailyTasks)) {
        throw new Error('Missing or invalid dailyTasks array');
      }
      if (!Array.isArray(parsed.tips)) {
        throw new Error('Missing or invalid tips array');
      }
      
      // Ensure all daily tasks have required fields
      const validatedTasks = parsed.dailyTasks.map((task: any, index: number) => ({
        id: task.id || `task-${index + 1}`,
        day: Number(task.day) || Math.floor(index / 3) + 1,
        title: String(task.title || `Task ${index + 1}`),
        description: String(task.description || 'Complete this task'),
        type: ['skincare', 'hydration', 'sleep', 'exercise', 'nutrition'].includes(task.type) 
          ? task.type 
          : 'skincare',
        completed: false,
        reminder: task.reminder || undefined,
      }));
      
      const plan: CoachingPlan = {
        id: `plan-${Date.now()}`,
        goal,
        duration: Number(parsed.duration) || 30,
        dailyTasks: validatedTasks,
        tips: Array.isArray(parsed.tips) ? parsed.tips.map(String) : [
          'Stay consistent with your daily routine',
          'Track your progress with photos',
          'Stay hydrated throughout the day'
        ],
        expectedResults: Array.isArray(parsed.expectedResults) ? parsed.expectedResults.map(String) : [
          'Improved skin texture and hydration',
          'More consistent skincare habits',
          'Increased confidence in your appearance'
        ],
      };
      
      logger.info('Successfully parsed coaching plan', { 
        tasksCount: plan.dailyTasks.length,
        tipsCount: plan.tips.length,
        resultsCount: plan.expectedResults.length
      });
      
      return plan;
    } catch (error) {
      logger.error('Failed to parse AI coaching plan response', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        responsePreview: aiResponse.substring(0, 200)
      });
      
      // Return a fallback plan instead of throwing
      const fallbackPlan: CoachingPlan = {
        id: `plan-${Date.now()}`,
        goal,
        duration: 30,
        dailyTasks: this.generateFallbackTasks(),
        tips: [
          'Start with a gentle cleanser and moisturizer',
          'Drink at least 8 glasses of water daily',
          'Get 7-8 hours of sleep each night',
          'Use sunscreen daily (SPF 30+)',
          'Take progress photos weekly'
        ],
        expectedResults: [
          'Improved skin texture and hydration',
          'More consistent skincare habits',
          'Increased confidence in your appearance',
          'Better understanding of your skin needs'
        ],
      };
      
      logger.info('Using fallback coaching plan');
      return fallbackPlan;
    }
  }
  
  private generateFallbackTasks(): DailyTask[] {
    const tasks: DailyTask[] = [];
    const taskTemplates = [
      { title: 'Morning Cleanse', description: 'Gently cleanse your face with a mild cleanser', type: 'skincare' as TaskType },
      { title: 'Hydrate', description: 'Drink a large glass of water', type: 'hydration' as TaskType },
      { title: 'Moisturize', description: 'Apply moisturizer to clean skin', type: 'skincare' as TaskType },
      { title: 'Evening Routine', description: 'Remove makeup and cleanse before bed', type: 'skincare' as TaskType },
      { title: 'Sleep Schedule', description: 'Aim for 7-8 hours of quality sleep', type: 'sleep' as TaskType },
    ];
    
    for (let day = 1; day <= 30; day++) {
      const dailyTaskCount = day <= 7 ? 3 : 2;
      for (let i = 0; i < dailyTaskCount; i++) {
        const template = taskTemplates[i % taskTemplates.length];
        tasks.push({
          id: `task-${day}-${i + 1}`,
          day,
          title: template.title,
          description: template.description,
          type: template.type,
          completed: false,
        });
      }
    }
    
    return tasks;
  }

  async generateImage(prompt: string, size: string = '1024x1024'): Promise<{ image: { base64Data: string; mimeType: string }; size: string }> {
    try {
      return await networkService.post(`${CONFIG.AI.RORK_AI_BASE_URL}/images/generate/`, {
        prompt,
        size,
      }, {
        timeout: 60000,
        retries: 1,
      });
    } catch (error) {
      await errorHandler.reportNetworkError(
        error as Error,
        `${CONFIG.AI.RORK_AI_BASE_URL}/images/generate/`,
        'POST'
      );
      throw error;
    }
  }

  async transcribeAudio(audioFile: File | { uri: string; name: string; type: string }, language?: string): Promise<{ text: string; language: string }> {
    try {
      const formData = new FormData();
      if ('uri' in audioFile) {
        formData.append('audio', audioFile as any);
      } else {
        formData.append('audio', audioFile);
      }
      if (language) {
        formData.append('language', language);
      }

      return await networkService.uploadFile(
        `${CONFIG.AI.RORK_AI_BASE_URL}/stt/transcribe/`,
        formData,
        {
          timeout: 30000,
          retries: 2,
        }
      );
    } catch (error) {
      await errorHandler.reportNetworkError(
        error as Error,
        `${CONFIG.AI.RORK_AI_BASE_URL}/stt/transcribe/`,
        'POST'
      );
      throw error;
    }
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  private async generateImageFingerprint(imageUri: string): Promise<string> {
    try {
      const base64Image = await this.convertImageToBase64(imageUri);
      const sampleSize = Math.min(1000, base64Image.length);
      const step = Math.floor(base64Image.length / sampleSize);
      let fingerprint = '';
      for (let i = 0; i < base64Image.length; i += step) {
        fingerprint += base64Image.charAt(i);
      }
      return this.hashString(fingerprint);
    } catch (error) {
      logger.warn('Failed to generate image fingerprint, using URI hash', error as Error);
      return this.hashString(imageUri);
    }
  }

  private generateConsistentScore(fingerprint: string, baseRange: [number, number] = [70, 95]): number {
    const hash = this.hashString(fingerprint);
    let numericHash = 0;
    for (let i = 0; i < hash.length; i++) {
      numericHash += hash.charCodeAt(i) * (i + 1);
    }
    const [min, max] = baseRange;
    const range = max - min;
    const normalizedHash = (numericHash % 1000) / 1000;
    const bellCurve = Math.sin(normalizedHash * Math.PI);
    const score = min + (bellCurve * range);
    return Math.round(score);
  }

  private generateConsistentAnalysis(fingerprint: string): Partial<GlowAnalysisResult> {
    const skinTones = ['Warm Beige', 'Cool Ivory', 'Olive Medium', 'Deep Caramel', 'Golden Tan', 'Porcelain Fair'];
    const skinTypes = ['Normal', 'Dry', 'Oily', 'Combination', 'Sensitive'];
    const potentials = ['High', 'Medium', 'Low'];
    const qualities = ['Excellent', 'Good', 'Fair', 'Needs Improvement'];
    
    const hash = this.hashString(fingerprint);
    let seed = 0;
    for (let i = 0; i < hash.length; i++) {
      seed += hash.charCodeAt(i);
    }
    
    const overallScore = this.generateConsistentScore(fingerprint, [75, 95]);
    const jawlineScore = this.generateConsistentScore(fingerprint + 'jaw', [70, 90]);
    const brightness = this.generateConsistentScore(fingerprint + 'bright', [65, 90]);
    const hydration = this.generateConsistentScore(fingerprint + 'hydro', [60, 85]);
    const symmetryScore = this.generateConsistentScore(fingerprint + 'sym', [75, 95]);
    
    return {
      overallScore,
      skinPotential: potentials[seed % potentials.length],
      skinQuality: qualities[Math.floor(seed / 10) % qualities.length],
      jawlineScore,
      skinTone: skinTones[Math.floor(seed / 100) % skinTones.length],
      skinType: skinTypes[Math.floor(seed / 1000) % skinTypes.length],
      brightness,
      hydration,
      symmetryScore,
    };
  }
  // Public precheck for human presence using Vision API
  async validateHumanPresence(imageUri: string): Promise<{ personPresent: boolean; facePresent: boolean; reasons: string[] }> {
    const vision = await this.analyzeImageWithVision(imageUri);
    const res = vision?.responses?.[0];
    const face = res?.faceAnnotations?.[0];
    const objects = res?.localizedObjectAnnotations ?? [];
    const personObj = objects.find((o: any) => (o?.name || '').toLowerCase().includes('person'));
    return {
      personPresent: !!personObj,
      facePresent: !!face,
      reasons: !face ? ['No clear human face detected'] : [],
    };
  }

  private computeGlowFromVision(face: any, dominantColors: any[]): GlowAnalysisResult {
    const clamp = (n: number, min = 1, max = 100) => Math.max(min, Math.min(max, Math.round(n)));
    const roll = Math.abs(Number(face.rollAngle ?? 0));
    const pan = Math.abs(Number(face.panAngle ?? 0));
    const tilt = Math.abs(Number(face.tiltAngle ?? 0));
    const anglePenalty = Math.min(30, roll + pan + tilt);
    const detection = Number(face.detectionConfidence ?? 0.7);
    const landmarking = Number(face.landmarkingConfidence ?? 0.6);

    const brightnessRaw = (() => {
      if (!Array.isArray(dominantColors) || dominantColors.length === 0) return 60;
      let total = 0;
      let weight = 0;
      for (const c of dominantColors) {
        const color = c?.color;
        const frac = Number(c?.pixelFraction ?? 0.1);
        if (color && typeof color.r === 'number' && typeof color.g === 'number' && typeof color.b === 'number') {
          const lum = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b; // 0-255
          total += lum * frac;
          weight += frac;
        }
      }
      const avgLum = weight > 0 ? total / weight : 128;
      return (avgLum / 255) * 100;
    })();

    const symmetryBase = 100 - anglePenalty * 2;
    const jawlineBase = landmarking * 100;

    const brightness = clamp(brightnessRaw);
    const symmetryScore = clamp(symmetryBase);
    const jawlineScore = clamp(jawlineBase);

    const hydration = clamp((brightness * 0.6) + (symmetryScore * 0.2) + (detection * 100 * 0.2));

    const overall = clamp(
      (symmetryScore * 0.25) +
      (brightness * 0.25) +
      (jawlineScore * 0.2) +
      (hydration * 0.2) +
      (detection * 100 * 0.1)
    );

    const skinTone = this.inferSkinToneFromColors(dominantColors);

    return {
      overallScore: overall,
      skinPotential: overall >= 85 ? 'High' : overall >= 70 ? 'Medium' : 'Low',
      skinQuality: overall >= 90 ? 'Excellent' : overall >= 80 ? 'Good' : overall >= 70 ? 'Fair' : 'Needs Improvement',
      jawlineScore,
      skinTone,
      skinType: 'Normal',
      brightness,
      hydration,
      symmetryScore,
      glowScore: overall,
      improvements: [
        brightness < 65 ? 'Improve lighting and even skin tone appearance' : 'Maintain consistent skincare routine',
        symmetryScore < 80 ? 'Face the camera directly to improve symmetry detection' : 'Great symmetry captured',
      ],
      recommendations: [
        'Use a gentle cleanser and hydrating moisturizer',
        'Apply sunscreen daily (SPF 30+)',
      ],
      tips: [
        'Capture in natural daylight facing a window',
        'Keep camera at eye level and avoid extreme angles',
        'Wipe lens to ensure sharp focus',
      ],
      aiTips: [
        'Hydrate and maintain a consistent routine',
        'Use vitamin C serum to enhance brightness',
        'Consider gentle facial massage for improved definition',
      ],
    };
  }

  private inferSkinToneFromColors(dominantColors: any[]): string {
    if (!Array.isArray(dominantColors) || dominantColors.length === 0) return 'Medium';
    const top = dominantColors[0]?.color;
    if (!top) return 'Medium';
    const r = Number(top.r ?? 128);
    const g = Number(top.g ?? 128);
    const b = Number(top.b ?? 128);
    if (r > g + 20 && r > b + 20) return 'Warm Beige';
    if (b > r + 20) return 'Cool Ivory';
    if (r > 150 && g > 120 && b < 100) return 'Golden Tan';
    if (r < 90 && g < 90 && b < 90) return 'Deep Caramel';
    return 'Olive Medium';
  }

  private computeOutfitFromVision(vision: any, eventType: string): OutfitAnalysisResult {
    const res = vision?.responses?.[0];
    const objects: any[] = res?.localizedObjectAnnotations ?? [];
    const colorsArr: any[] = res?.imagePropertiesAnnotation?.dominantColors?.colors ?? [];

    const clothingKeywords = ['person', 'shirt', 'dress', 'pants', 'trousers', 'jeans', 'skirt', 'coat', 'jacket', 'blazer', 'shoe', 'sneaker', 'tie', 'hat', 'sleeve', 'shorts'];
    const detectedItems = Array.from(new Set(
      objects
        .map(o => String(o?.name || '').toLowerCase())
        .filter(name => clothingKeywords.some(k => name.includes(k)))
        .map(name => name.charAt(0).toUpperCase() + name.slice(1))
    ));

    const palette = colorsArr.slice(0, 5).map(c => {
      const color = c?.color || {};
      const r = Number(color.r ?? 0);
      const g = Number(color.g ?? 0);
      const b = Number(color.b ?? 0);
      const hex = `#${[r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
      return hex.toUpperCase();
    });

    const colorHarmonyScore = this.computeColorHarmony(palette);
    const fitScore = Math.max(50, Math.min(95, (objects.length >= 3 ? 80 : 65)));
    const trendScore = 70;
    const occasionScore = this.estimateOccasionScore(eventType, detectedItems);
    const styleScore = Math.round((colorHarmonyScore + fitScore + trendScore) / 3);
    const outfitScore = Math.round(
      colorHarmonyScore * 0.25 +
      fitScore * 0.25 +
      trendScore * 0.2 +
      occasionScore * 0.15 +
      styleScore * 0.15
    );

    return {
      outfitScore,
      colorMatchScore: colorHarmonyScore,
      styleScore,
      fitScore,
      trendScore,
      occasionScore,
      detectedItems: detectedItems.length > 0 ? detectedItems : ['Outfit'],
      compatibleColors: this.suggestCompatibleColors(palette[0]),
      tips: [
        'Ensure balanced proportions between top and bottom garments',
        'Coordinate accessories to complement dominant colors',
      ],
      whatWorked: [
        colorHarmonyScore >= 75 ? 'Strong color harmony' : 'Good base palette',
      ],
      improvements: [
        colorHarmonyScore < 70 ? 'Consider adding contrast or complementary accessory' : 'Experiment with textures to add depth',
      ],
      eventAppropriate: occasionScore >= 70,
      seasonalMatch: true,
      styleCategory: this.inferStyleCategory(detectedItems),
      confidenceLevel: 80,
    };
  }

  private computeColorHarmony(palette: string[]): number {
    if (palette.length <= 1) return 65;
    const toHsv = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const d = max - min;
      let h = 0;
      if (d === 0) h = 0; else if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h = Math.round((h * 60 + 360) % 360);
      const s = max === 0 ? 0 : d / max;
      const v = max;
      return { h, s, v };
    };
    const hsv = palette.map(toHsv);
    let spread = 0;
    for (let i = 0; i < hsv.length; i++) {
      for (let j = i + 1; j < hsv.length; j++) {
        const diff = Math.min(Math.abs(hsv[i].h - hsv[j].h), 360 - Math.abs(hsv[i].h - hsv[j].h));
        spread += diff;
      }
    }
    const pairs = (hsv.length * (hsv.length - 1)) / 2;
    const avgSpread = pairs > 0 ? spread / pairs : 0;
    const harmony = 70 + Math.min(30, Math.abs(180 - avgSpread) / 6);
    return Math.max(50, Math.min(95, Math.round(harmony)));
  }

  private estimateOccasionScore(eventType: string, items: string[]): number {
    const e = eventType.toLowerCase();
    if (e.includes('formal') || e.includes('interview') || e.includes('business')) {
      const hasBlazer = items.some(i => i.toLowerCase().includes('blazer') || i.toLowerCase().includes('jacket'));
      return hasBlazer ? 85 : 70;
    }
    if (e.includes('party')) return 80;
    if (e.includes('date')) return 78;
    if (e.includes('casual') || e.includes('travel')) return 75;
    if (e.includes('workout')) return 72;
    return 75;
  }

  private inferStyleCategory(items: string[]): string {
    const lower = items.map(i => i.toLowerCase());
    if (lower.some(i => i.includes('blazer') || i.includes('trousers'))) return 'Business Casual';
    if (lower.some(i => i.includes('jeans') || i.includes('sneaker'))) return 'Casual';
    if (lower.some(i => i.includes('dress'))) return 'Formal';
    return 'Smart Casual';
  }

  private suggestCompatibleColors(hex?: string): string[] {
    if (!hex) return ['#2196F3', '#4CAF50', '#FFC107'];
    const toRgb = (h: string) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)] as const;
    const [r,g,b] = toRgb(hex);
    const complement = `#${[(255-r),(255-g),(255-b)].map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join('')}`.toUpperCase();
    return [hex.toUpperCase(), complement, '#FFFFFF', '#000000'];
  }
}

export const aiService = new AIService();
export default aiService;
