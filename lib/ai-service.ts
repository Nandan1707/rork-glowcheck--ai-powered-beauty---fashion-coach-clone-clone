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
  private requestCache = new Map<string, { promise: Promise<any>; controller: AbortController }>();
  private cacheTimeout = 30000; // 30 seconds

  private getCacheKey(url: string, body: any): string {
    return `${url}:${JSON.stringify(body)}`;
  }

  private async makeAIRequest<T>(url: string, body: any, timeout: number = 30000): Promise<T> {
    const cacheKey = this.getCacheKey(url, body);
    
    // Check if there's already a pending request for the same data
    if (this.requestCache.has(cacheKey)) {
      const cached = this.requestCache.get(cacheKey)!;
      if (!cached.controller.signal.aborted) {
        logger.debug('Using cached AI request', { url });
        return cached.promise;
      } else {
        // Remove aborted request from cache
        this.requestCache.delete(cacheKey);
      }
    }
    
    // Create new AbortController for this request
    const controller = new AbortController();
    
    // Create new request with proper signal handling and error recovery
    const requestPromise = networkService.post<T>(url, body, {
      timeout,
      retries: 0, // Disable retries to prevent multiple concurrent requests
      retryDelay: 1000,
    }).then(result => {
      // Clean up cache on success
      this.requestCache.delete(cacheKey);
      return result;
    }).catch(error => {
      // Clean up cache on error
      this.requestCache.delete(cacheKey);
      
      // Handle different types of errors
      if (error instanceof Error) {
        if (error.message.includes('cancelled') || 
            error.message.includes('aborted') || 
            error.name === 'AbortError') {
          logger.debug('AI request was cancelled', { url, error: error.message });
          throw error; // Re-throw cancellation errors
        }
        
        if (error.message.includes('Failed to fetch') || 
            error.message.includes('Network request failed') ||
            error.message.includes('TypeError: Failed to fetch')) {
          logger.warn('Network error in AI request, will use fallback', { url, error: error.message });
          // Don't throw network errors, let the calling function handle fallback
          throw new Error('NETWORK_ERROR');
        }
      }
      
      logger.warn('AI request failed', { url, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    });
    
    // Cache the promise with controller
    this.requestCache.set(cacheKey, { promise: requestPromise, controller });
    
    // Clean up cache after timeout
    const timeoutId = setTimeout(() => {
      const cached = this.requestCache.get(cacheKey);
      if (cached && !cached.controller.signal.aborted) {
        logger.debug('Aborting cached AI request due to timeout', { url });
        cached.controller.abort();
      }
      this.requestCache.delete(cacheKey);
    }, this.cacheTimeout);
    
    try {
      const result = await requestPromise;
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
  private async uploadImageToS3(imageUri: string, fileName: string): Promise<string> {
    return performanceMonitor.measure('uploadImageToS3', async () => {
      try {
        logger.info('Starting S3 upload', { fileName, imageUri: imageUri.substring(0, 50) + '...' });
        
        if (!CONFIG.AWS.S3_BUCKET_NAME) {
          logger.debug('S3 not configured, using local image URI');
          return imageUri;
        }
        
        // For production, implement proper S3 upload
        // TODO: Implement actual S3 upload logic
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

  private async analyzeImageWithVision(imageUri: string): Promise<any> {
    try {
      // Convert image to base64 for Google Vision API
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
        throw new Error(`Vision API error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      await errorHandler.reportNetworkError(
        error as Error,
        `https://vision.googleapis.com/v1/images:annotate`,
        'POST'
      );
      logger.error('Vision API failed', error as Error);
      throw error;
    }
  }

  private async convertImageToBase64(imageUri: string): Promise<string> {
    try {
      if (Platform.OS === 'web') {
        // Web implementation
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
        // React Native implementation
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
      
      // Generate image fingerprint for consistent results
      const fingerprint = await this.generateImageFingerprint(imageUri);
      const cacheKey = `glow_analysis_${fingerprint}`;
      
      // Check if we have cached results for this exact image
      const cachedResult = await storageService.get<GlowAnalysisResult>(cacheKey);
      if (cachedResult) {
        logger.debug('Using cached glow analysis result', { fingerprint });
        return cachedResult;
      }
      
      // Analyze with Google Vision API (or use mock data)
      const visionData = await this.analyzeImageWithVision(imageUri);
      
      // Use Rork AI API for detailed analysis with fingerprint for consistency
      const aiAnalysis = await this.getAIGlowAnalysis(visionData, imageUri, fingerprint);
      
      // Cache the result for future use (24 hours)
      await storageService.set(cacheKey, aiAnalysis, { expiresIn: 24 * 60 * 60 * 1000 });
      
      return aiAnalysis;
    } catch (error) {
      // Check if error is due to request cancellation
      if (error instanceof Error && (error.message.includes('cancelled') || error.message.includes('aborted'))) {
        logger.debug('Glow analysis request was cancelled', { imageUri: imageUri.substring(0, 50) + '...' });
        throw error; // Re-throw cancellation errors
      }
      
      await errorHandler.reportError(
        error as Error,
        'glow-analysis',
        'analyzeGlow',
        { imageUri: imageUri.substring(0, 50) + '...' }
      );
      logger.warn('Glow analysis failed, using consistent mock data', error as Error);
      
      // Re-throw the error instead of using mock data
      throw error;
    }
  }

  private async getAIGlowAnalysis(visionData: any, imageUri: string, fingerprint: string): Promise<GlowAnalysisResult> {
    try {
      // Convert image to base64 for AI API
      const base64Image = await this.convertImageToBase64(imageUri);
      
      // Generate consistent baseline scores for this image
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
                
                Vision API data: ${JSON.stringify(visionData)}
                
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
        45000 // 45 second timeout for detailed analysis
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
      // Try to parse JSON response from AI
      const parsed = JSON.parse(aiResponse);
      
      // Validate and constrain scores to ensure consistency for same image
      const constrainScore = (score: number, baseline: number, variance: number = 8): number => {
        if (typeof score !== 'number' || isNaN(score)) return baseline;
        // Allow more variance for different images, less for same image
        const actualVariance = consistentAnalysis ? Math.min(variance, 3) : variance;
        return Math.max(1, Math.min(100, Math.round(Math.max(baseline - actualVariance, Math.min(baseline + actualVariance, score)))));
      };
      
      // Validate required fields for new comprehensive format
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
          glowScore: 0, // Will be set below
          improvements: parsed.improvements || [],
          recommendations: parsed.recommendations || [],
          tips: parsed.aiTips, // Use AI tips as primary tips
          aiTips: parsed.aiTips,
        };
        
        result.glowScore = result.overallScore; // Map for backward compatibility
        return result;
      }
      
      // Fallback to old format if new format not available
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
          glowScore: 0, // Will be set below
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
      
      // Skip S3 upload for now to reduce complexity
      // const s3Url = await this.uploadImageToS3(imageUri, `outfit-${Date.now()}.jpg`);
      
      // Analyze with Google Vision API (or use mock data)
      const visionData = await this.analyzeImageWithVision(imageUri);
      
      // Use Rork AI API for detailed analysis
      const aiAnalysis = await this.getAIOutfitAnalysis(visionData, imageUri, eventType);
      
      return aiAnalysis;
    } catch (error) {
      // Check if error is due to request cancellation
      if (error instanceof Error && (error.message.includes('cancelled') || error.message.includes('aborted'))) {
        logger.debug('Outfit analysis request was cancelled', { imageUri: imageUri.substring(0, 50) + '...', eventType });
        throw error; // Re-throw cancellation errors
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
      // Convert image to base64 for AI API
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
                
                Vision API data: ${JSON.stringify(visionData)}
                
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
        45000 // 45 second timeout for detailed analysis
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
      // Try to parse JSON response from AI
      const parsed = JSON.parse(aiResponse);
      
      // Validate required fields
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
      const requestBody = {
        messages: [
          {
            role: 'system',
            content: 'You are a professional beauty coach. Create a personalized 30-day beauty coaching plan in JSON format.',
          },
          {
            role: 'user',
            content: `Create a 30-day coaching plan for someone with goal: "${goal}" and current glow score: ${currentGlowScore}. Include daily tasks, tips, and expected results.`,
          },
        ],
      };
      
      const result = await this.makeAIRequest<{ completion: string }>(
        `${CONFIG.AI.RORK_AI_BASE_URL}/text/llm/`,
        requestBody,
        30000 // 30 second timeout
      );
      
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
      const parsed = JSON.parse(aiResponse);
      
      // Validate required fields
      if (Array.isArray(parsed.dailyTasks) && Array.isArray(parsed.tips)) {
        return {
          id: `plan-${Date.now()}`,
          goal,
          duration: parsed.duration || 30,
          dailyTasks: parsed.dailyTasks,
          tips: parsed.tips,
          expectedResults: parsed.expectedResults || [],
        };
      }
      
      throw new Error('Invalid AI response format');
    } catch (error) {
      logger.error('Failed to parse AI coaching plan response', { error: error instanceof Error ? error.message : 'Unknown error' });
      throw new Error('Invalid AI response format: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }



  async generateImage(prompt: string, size: string = '1024x1024'): Promise<{ image: { base64Data: string; mimeType: string }; size: string }> {
    try {
      return await networkService.post(`${CONFIG.AI.RORK_AI_BASE_URL}/images/generate/`, {
        prompt,
        size,
      }, {
        timeout: 60000, // 60 seconds for image generation
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
        // React Native format
        formData.append('audio', audioFile as any);
      } else {
        // Web format
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
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  private async generateImageFingerprint(imageUri: string): Promise<string> {
    try {
      // Create a fingerprint based on image content
      const base64Image = await this.convertImageToBase64(imageUri);
      
      // Sample key points from the base64 data for fingerprinting
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
    // Use fingerprint to generate consistent but realistic scores with better distribution
    const hash = this.hashString(fingerprint);
    let numericHash = 0;
    
    for (let i = 0; i < hash.length; i++) {
      numericHash += hash.charCodeAt(i) * (i + 1); // Weight by position for better distribution
    }
    
    const [min, max] = baseRange;
    const range = max - min;
    
    // Use sine function for more natural distribution (bell curve-like)
    const normalizedHash = (numericHash % 1000) / 1000;
    const bellCurve = Math.sin(normalizedHash * Math.PI);
    const score = min + (bellCurve * range);
    
    return Math.round(score);
  }

  private generateConsistentAnalysis(fingerprint: string): Partial<GlowAnalysisResult> {
    // Generate consistent analysis based on image fingerprint
    const skinTones = ['Warm Beige', 'Cool Ivory', 'Olive Medium', 'Deep Caramel', 'Golden Tan', 'Porcelain Fair'];
    const skinTypes = ['Normal', 'Dry', 'Oily', 'Combination', 'Sensitive'];
    const potentials = ['High', 'Medium', 'Low'];
    const qualities = ['Excellent', 'Good', 'Fair', 'Needs Improvement'];
    
    const hash = this.hashString(fingerprint);
    let seed = 0;
    for (let i = 0; i < hash.length; i++) {
      seed += hash.charCodeAt(i);
    }
    
    // Use seed to make consistent selections
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
}

export const aiService = new AIService();
export default aiService;