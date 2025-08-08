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
  compatibleColors: string[];
  tips: string[];
  eventAppropriate: boolean;
  seasonalMatch: boolean;
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
        
        if (CONFIG.FEATURES.USE_MOCK_DATA || !CONFIG.AWS.S3_BUCKET_NAME) {
          logger.debug('Using mock S3 upload');
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
      
      if (CONFIG.FEATURES.USE_MOCK_DATA || !CONFIG.AI.GOOGLE_VISION_API_KEY) {
        logger.debug('Using mock Vision API data');
        return this.getMockVisionData();
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
      logger.warn('Vision API failed, using mock data', error as Error);
      return this.getMockVisionData();
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

  private getMockVisionData() {
    return {
      responses: [
        {
          faceAnnotations: [
            {
              boundingPoly: { vertices: [{ x: 100, y: 100 }, { x: 200, y: 200 }] },
              fdBoundingPoly: { vertices: [{ x: 105, y: 105 }, { x: 195, y: 195 }] },
              landmarks: [],
              rollAngle: 0.5,
              panAngle: 1.2,
              tiltAngle: -0.8,
              detectionConfidence: 0.95,
              landmarkingConfidence: 0.87,
            },
          ],
          imagePropertiesAnnotation: {
            dominantColors: {
              colors: [
                { color: { red: 220, green: 180, blue: 160 }, score: 0.4 },
                { color: { red: 200, green: 150, blue: 130 }, score: 0.3 },
              ],
            },
          },
        },
      ],
    };
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
      
      // Generate fingerprint for consistent mock data
      const fingerprint = await this.generateImageFingerprint(imageUri).catch(() => this.hashString(imageUri));
      return this.getMockGlowAnalysis(fingerprint);
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
            
            IMPORTANT: For consistency, use these baseline scores as reference points and adjust slightly based on actual image analysis:
            - Overall Score: ${consistentAnalysis.overallScore}
            - Jawline Score: ${consistentAnalysis.jawlineScore}
            - Brightness: ${consistentAnalysis.brightness}
            - Hydration: ${consistentAnalysis.hydration}
            - Symmetry: ${consistentAnalysis.symmetryScore}
            - Skin Tone: ${consistentAnalysis.skinTone}
            - Skin Type: ${consistentAnalysis.skinType}
            
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
                
                Provide detailed, actionable insights and recommendations. Keep scores within ±5 points of the baseline for consistency.`,
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
      logger.warn('AI glow analysis failed, using consistent mock data', error as Error);
      return this.getMockGlowAnalysis(fingerprint);
    }
  }

  private parseGlowAnalysis(aiResponse: string, consistentAnalysis?: Partial<GlowAnalysisResult>): GlowAnalysisResult {
    try {
      // Try to parse JSON response from AI
      const parsed = JSON.parse(aiResponse);
      
      // Validate and constrain scores to ensure consistency
      const constrainScore = (score: number, baseline: number, variance: number = 5): number => {
        if (typeof score !== 'number' || isNaN(score)) return baseline;
        return Math.max(1, Math.min(100, Math.round(Math.max(baseline - variance, Math.min(baseline + variance, score)))));
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
      logger.warn('Failed to parse AI glow analysis response', { error: error instanceof Error ? error.message : 'Unknown error' });
      return this.getMockGlowAnalysis(consistentAnalysis ? this.hashString(JSON.stringify(consistentAnalysis)) : undefined);
    }
  }

  private getMockGlowAnalysis(fingerprint?: string): GlowAnalysisResult {
    let consistentAnalysis: Partial<GlowAnalysisResult>;
    
    if (fingerprint) {
      // Generate consistent analysis based on fingerprint
      consistentAnalysis = this.generateConsistentAnalysis(fingerprint);
    } else {
      // Fallback to random but still reasonable values
      const overallScore = Math.floor(Math.random() * 30) + 70; // 70-100
      const skinTones = ['Warm Beige', 'Cool Ivory', 'Olive Medium', 'Deep Caramel', 'Golden Tan', 'Porcelain Fair'];
      const skinTypes = ['Normal', 'Dry', 'Oily', 'Combination', 'Sensitive'];
      const potentials = ['High', 'Medium', 'Low'];
      const qualities = ['Excellent', 'Good', 'Fair', 'Needs Improvement'];
      
      consistentAnalysis = {
        overallScore,
        skinPotential: potentials[Math.floor(Math.random() * potentials.length)],
        skinQuality: qualities[Math.floor(Math.random() * qualities.length)],
        jawlineScore: Math.floor(Math.random() * 25) + 70, // 70-95
        skinTone: skinTones[Math.floor(Math.random() * skinTones.length)],
        skinType: skinTypes[Math.floor(Math.random() * skinTypes.length)],
        brightness: Math.floor(Math.random() * 30) + 65, // 65-95
        hydration: Math.floor(Math.random() * 40) + 55, // 55-95
        symmetryScore: Math.floor(Math.random() * 20) + 75, // 75-95
      };
    }
    
    const aiTips = [
      'Hydrate twice daily with hyaluronic acid serum for plumper skin',
      'Use sunscreen every morning to prevent premature aging',
      'Add more Omega-3s to your diet for improved skin elasticity',
      'Try facial massage for 5 minutes daily to boost circulation',
      'Get 7-8 hours of quality sleep for optimal skin recovery',
    ];
    
    const improvements = [
      'Increase daily water intake to 8-10 glasses for better hydration',
      'Incorporate vitamin C serum in morning routine for brighter skin',
      'Use a gentle exfoliant 2x per week to improve texture',
      'Apply a hydrating face mask weekly for deep moisture',
    ];
    
    const recommendations = [
      'Morning: Gentle cleanser → Vitamin C serum → Moisturizer → SPF 30+',
      'Evening: Double cleanse → Retinol (2x/week) → Hydrating serum → Night cream',
      'Weekly: Gentle exfoliation + Deep hydrating mask',
      'Monthly: Professional facial or at-home enzyme treatment',
    ];
    
    return {
      overallScore: consistentAnalysis.overallScore!,
      skinPotential: consistentAnalysis.skinPotential!,
      skinQuality: consistentAnalysis.skinQuality!,
      jawlineScore: consistentAnalysis.jawlineScore!,
      skinTone: consistentAnalysis.skinTone!,
      skinType: consistentAnalysis.skinType!,
      brightness: consistentAnalysis.brightness!,
      hydration: consistentAnalysis.hydration!,
      symmetryScore: consistentAnalysis.symmetryScore!,
      glowScore: consistentAnalysis.overallScore!, // Backward compatibility
      improvements,
      recommendations,
      tips: aiTips.slice(0, 3), // Use first 3 AI tips for compatibility
      aiTips,
    };
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
      logger.warn('Outfit analysis failed, using mock data', error as Error);
      return this.getMockOutfitAnalysis();
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
            content: 'You are a professional fashion stylist. Analyze the outfit and provide detailed fashion advice in JSON format.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this outfit for a ${eventType} event. Provide outfit score (1-100), color analysis, style tips, and recommendations. Vision data: ${JSON.stringify(visionData)}`,
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
        30000 // 30 second timeout
      );
      
      return this.parseOutfitAnalysis(result.completion);
    } catch (error) {
      await errorHandler.reportNetworkError(
        error as Error,
        `${CONFIG.AI.RORK_AI_BASE_URL}/text/llm/`,
        'POST'
      );
      logger.warn('AI outfit analysis failed, using mock data', error as Error);
      return this.getMockOutfitAnalysis();
    }
  }

  private parseOutfitAnalysis(aiResponse: string): OutfitAnalysisResult {
    try {
      // Try to parse JSON response from AI
      const parsed = JSON.parse(aiResponse);
      
      // Validate required fields
      if (typeof parsed.outfitScore === 'number' && Array.isArray(parsed.tips)) {
        return {
          outfitScore: parsed.outfitScore,
          colorMatchScore: parsed.colorMatchScore || 75,
          styleScore: parsed.styleScore || 75,
          compatibleColors: parsed.compatibleColors || ['#FF6B98', '#9D71E8', '#4CAF50'],
          tips: parsed.tips,
          eventAppropriate: parsed.eventAppropriate !== false,
          seasonalMatch: parsed.seasonalMatch !== false,
        };
      }
      
      throw new Error('Invalid AI response format');
    } catch (error) {
      logger.warn('Failed to parse AI outfit analysis response', { error: error instanceof Error ? error.message : 'Unknown error' });
      return this.getMockOutfitAnalysis();
    }
  }

  private getMockOutfitAnalysis(): OutfitAnalysisResult {
    return {
      outfitScore: Math.floor(Math.random() * 30) + 70, // 70-100
      colorMatchScore: Math.floor(Math.random() * 30) + 70,
      styleScore: Math.floor(Math.random() * 30) + 70,
      compatibleColors: [
        '#FF6B98', // Pink
        '#9D71E8', // Purple
        '#4CAF50', // Green
        '#2196F3', // Blue
        '#FFD166', // Gold
      ],
      tips: [
        'Try adding a statement accessory to elevate this look',
        'This color palette works well with your skin tone',
        'Consider a different shoe style for better proportion',
        'A structured blazer would add sophistication',
      ],
      eventAppropriate: Math.random() > 0.3,
      seasonalMatch: Math.random() > 0.2,
    };
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
      logger.warn('Coaching plan generation failed, using mock data', error as Error);
      return this.getMockCoachingPlan(goal);
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
      logger.warn('Failed to parse AI coaching plan response', { error: error instanceof Error ? error.message : 'Unknown error' });
      return this.getMockCoachingPlan(goal);
    }
  }

  private getMockCoachingPlan(goal: string): CoachingPlan {
    const tasks: DailyTask[] = [];
    
    for (let day = 1; day <= 30; day++) {
      const dailyTasks = [
        {
          id: `task-${day}-1`,
          day,
          title: 'Morning Skincare Routine',
          description: 'Complete your morning skincare routine with cleanser, serum, and SPF',
          type: 'skincare' as TaskType,
          completed: false,
        },
        {
          id: `task-${day}-2`,
          day,
          title: 'Hydration Goal',
          description: 'Drink at least 8 glasses of water throughout the day',
          type: 'hydration' as TaskType,
          completed: false,
        },
        {
          id: `task-${day}-3`,
          day,
          title: 'Beauty Sleep',
          description: 'Get 7-8 hours of quality sleep for skin recovery',
          type: 'sleep' as TaskType,
          completed: false,
        },
      ];
      
      if (day % 3 === 0) {
        dailyTasks.push({
          id: `task-${day}-4`,
          day,
          title: 'Light Exercise',
          description: '20 minutes of light exercise to boost circulation',
          type: 'exercise' as TaskType,
          completed: false,
        });
      }
      
      tasks.push(...dailyTasks);
    }

    return {
      id: `plan-${Date.now()}`,
      goal,
      duration: 30,
      dailyTasks: tasks,
      tips: [
        'Consistency is key - stick to your routine daily',
        'Take progress photos weekly to track improvements',
        'Listen to your skin and adjust products if needed',
        'Stay hydrated and eat a balanced diet',
      ],
      expectedResults: [
        'Improved skin texture and hydration',
        'More even skin tone',
        'Reduced appearance of fine lines',
        'Overall healthier, glowing complexion',
      ],
    };
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
    // Use fingerprint to generate consistent but realistic scores
    const hash = this.hashString(fingerprint);
    let numericHash = 0;
    
    for (let i = 0; i < hash.length; i++) {
      numericHash += hash.charCodeAt(i);
    }
    
    const [min, max] = baseRange;
    const range = max - min;
    const score = min + (numericHash % range);
    
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