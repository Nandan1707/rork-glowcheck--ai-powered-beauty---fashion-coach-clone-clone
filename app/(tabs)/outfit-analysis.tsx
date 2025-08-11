import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, ActivityIndicator, Platform, Alert } from 'react-native';
import { CameraView, CameraType } from 'expo-camera';
import { Camera, RefreshCw, Shirt, Crown, Lock, Upload, CheckCircle, XCircle, Palette, Sparkles, TrendingUp, Calendar } from 'lucide-react-native';
import { Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import Button from '@/components/Button';
import Card from '@/components/Card';
import ProgressBar from '@/components/ProgressBar';
import PremiumModal from '@/components/PremiumModal';
import RouteGuard from '@/components/RouteGuard';
import { useAuth } from '@/hooks/auth-store';
import { usePremiumAccess } from '@/hooks/subscription-store';
import { COLORS } from '@/constants/colors';
import { aiService, OutfitAnalysisResult } from '@/lib/ai-service';

export default function OutfitAnalysisScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraActive, setCameraActive] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [eventType, setEventType] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<OutfitAnalysisResult | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [takingPicture, setTakingPicture] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  
  const cameraRef = useRef<any>(null);
  const { isPremium } = useAuth();
  const { hasPremiumAccess } = usePremiumAccess();



  const eventTypes = [
    { id: 'date-night', label: 'Date Night', icon: '💕' },
    { id: 'job-interview', label: 'Job Interview', icon: '💼' },
    { id: 'casual-outing', label: 'Casual Outing', icon: '☀️' },
    { id: 'formal-event', label: 'Formal Event', icon: '🎩' },
    { id: 'business-meeting', label: 'Business Meeting', icon: '📊' },
    { id: 'party', label: 'Party/Social', icon: '🎉' },
    { id: 'workout', label: 'Workout/Active', icon: '💪' },
    { id: 'travel', label: 'Travel/Vacation', icon: '✈️' },
  ];

  const takePicture = async () => {
    if (!cameraRef.current || takingPicture) return;
    
    setTakingPicture(true);
    
    try {
      // On web, wait a bit for camera to be fully ready
      if (Platform.OS === 'web' && !cameraReady) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: false,
        skipProcessing: Platform.OS === 'web', // Skip processing on web for faster capture
      });
      
      setCapturedImage(photo.uri);
      setCameraActive(false);
      setCameraReady(false);
    } catch (error) {
      console.error('Error taking picture:', error);
      // Show user-friendly error message
      if (Platform.OS === 'web') {
        alert('Camera not ready yet. Please wait a moment and try again.');
      }
    } finally {
      setTakingPicture(false);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 4],
      quality: 1,
    });

    if (!result.canceled) {
      setCapturedImage(result.assets[0].uri);
    }
  };

  const analyzeOutfit = async () => {
    if (!capturedImage || !eventType) return;
    
    if (!hasPremiumAccess) {
      setShowPremiumModal(true);
      return;
    }
    
    setAnalyzing(true);
    
    try {
      const precheck: any = await (aiService as any)['analyzeImageWithGemini'](capturedImage);
      if (!precheck?.facePresent) {
        const hint = precheck?.reasons?.[0] || 'No person detected or subject is obstructed';
        throw new Error(`${hint}. Please upload a clear full/half-body photo with good lighting.`);
      }
      const selectedEvent = eventTypes.find(e => e.id === eventType);
      const result = await aiService.analyzeOutfit(capturedImage, selectedEvent?.label || eventType);
      setAnalysisResult(result);
    } catch (error) {
      console.error('Error analyzing outfit:', error);
      Alert.alert(
        'Analysis Failed',
        error instanceof Error ? error.message : 'Unable to analyze your outfit right now. Please try again later.',
        [{ text: 'OK' }]
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const resetAnalysis = () => {
    setCapturedImage(null);
    setEventType('');
    setAnalysisResult(null);
  };

  const toggleCamera = () => {
    if (!permission?.granted) {
      requestPermission();
    } else {
      setCameraActive(!cameraActive);
      if (!cameraActive) {
        setCameraReady(false);
        // On web, set camera ready after a delay
        if (Platform.OS === 'web') {
          setTimeout(() => setCameraReady(true), 2000);
        } else {
          setTimeout(() => setCameraReady(true), 500);
        }
      }
    }
  };

  const toggleCameraFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  if (cameraActive) {
    return (
      <View style={styles.cameraContainer}>
        <Stack.Screen options={{ headerShown: false }} />
        <CameraView
          style={styles.camera}
          facing={facing}
          ref={cameraRef}
          onCameraReady={() => {
            console.log('Camera ready');
            setCameraReady(true);
          }}
        >
          <View style={styles.cameraOverlay}>
            <View style={styles.cameraGuide}>
              <View style={styles.cameraGuideFrame} />
            </View>
            <Text style={styles.cameraInstructions}>
              {!cameraReady 
                ? 'Preparing camera...' 
                : 'Capture your full outfit within the frame'
              }
            </Text>
          </View>
          <View style={styles.cameraControls}>
            <TouchableOpacity 
              style={styles.cameraButton} 
              onPress={toggleCameraFacing}
            >
              <RefreshCw color={COLORS.white} size={24} />
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.captureButton, (!cameraReady || takingPicture) && styles.captureButtonDisabled]} 
              onPress={takePicture}
              disabled={!cameraReady || takingPicture}
            >
              {takingPicture ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <View style={styles.captureButtonInner} />
              )}
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.cameraButton} 
              onPress={() => setCameraActive(false)}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </CameraView>
      </View>
    );
  }

  return (
    <RouteGuard requireAuth>
      <ScrollView style={styles.container}>
        <Stack.Screen options={{ 
          title: 'Outfit Analysis',
          headerTitleStyle: {
            fontWeight: '600',
          },
        }} />

        {!hasPremiumAccess && (
          <Card style={styles.premiumCard}>
            <View style={styles.premiumContent}>
              <Lock size={24} color={COLORS.accent} style={styles.premiumIcon} />
              <View style={styles.premiumTextContainer}>
                <Text style={styles.premiumTitle}>Premium Feature</Text>
                <Text style={styles.premiumDescription}>
                  Upgrade to premium to access AI-powered outfit analysis with personalized style suggestions.
                </Text>
              </View>
            </View>
            <Button
              title="Upgrade to Premium"
              variant="secondary"
              style={styles.premiumButton}
              leftIcon={<Crown size={18} color={COLORS.primary} />}
              onPress={() => setShowPremiumModal(true)}
            />
          </Card>
        )}

        {!analysisResult ? (
          <View style={styles.startContainer}>
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1589710751893-f9a6770ad71b?q=80&w=500&auto=format&fit=crop' }}
              style={styles.startImage}
            />
            <View style={styles.titleContainer}>
              <Text style={styles.startTitle}>AI Outfit Analysis</Text>
              {hasPremiumAccess && (
                <View style={styles.premiumBadge}>
                  <Crown size={16} color={COLORS.gold} />
                  <Text style={styles.premiumText}>Premium</Text>
                </View>
              )}
            </View>
            <Text style={styles.startDescription}>
              Get personalized outfit ratings and style suggestions for any occasion.
            </Text>
          
          {!capturedImage ? (
            <View style={styles.buttonContainer}>
              <Button
                title="Take Photo"
                onPress={toggleCamera}
                leftIcon={<Camera size={18} color={COLORS.white} style={{ marginRight: 8 }} />}
                style={styles.button}
                testID="take-photo-button"
              />
              <Button
                title="Upload Photo"
                variant="outline"
                onPress={pickImage}
                style={styles.button}
                testID="upload-photo-button"
              />
            </View>
          ) : (
            <View style={styles.outfitSetupContainer}>
              <Image
                source={{ uri: capturedImage }}
                style={styles.outfitImage}
              />
              
              <Text style={styles.eventTypeLabel}>What&apos;s the occasion?</Text>
              <View style={styles.eventTypeContainer}>
                {eventTypes.map((type) => (
                  <TouchableOpacity
                    key={type.id}
                    style={[
                      styles.eventTypeButton,
                      eventType === type.id && styles.eventTypeButtonSelected,
                    ]}
                    onPress={() => setEventType(type.id)}
                  >
                    <Text style={styles.eventTypeEmoji}>{type.icon}</Text>
                    <Text
                      style={[
                        styles.eventTypeButtonText,
                        eventType === type.id && styles.eventTypeButtonTextSelected,
                      ]}
                    >
                      {type.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              
              {analyzing ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={COLORS.secondary} />
                  <Text style={styles.analyzingText}>Analyzing your outfit...</Text>
                </View>
              ) : (
                <View style={styles.actionButtons}>
                  <Button
                    title={hasPremiumAccess ? "Analyze Outfit" : "Upgrade to Analyze"}
                    onPress={analyzeOutfit}
                    disabled={!eventType}
                    style={styles.analyzeButton}
                    variant="secondary"
                    leftIcon={!hasPremiumAccess ? <Crown size={18} color={COLORS.white} /> : undefined}
                  />
                  <Button
                    title="Change Photo"
                    variant="outline"
                    onPress={resetAnalysis}
                    style={styles.changeButton}
                  />
                </View>
              )}
            </View>
          )}
        </View>
      ) : (
        <View style={styles.resultContainer}>
          <View style={styles.resultHeader}>
            <Image
              source={{ uri: capturedImage || 'https://images.unsplash.com/photo-1589710751893-f9a6770ad71b?q=80&w=500&auto=format&fit=crop' }}
              style={styles.resultImage}
            />
            <View style={styles.resultInfo}>
              <Text style={styles.eventTypeResult}>
                {eventTypes.find(e => e.id === eventType)?.label || eventType}
              </Text>
              <View style={styles.scoreContainer}>
                <Text style={styles.scoreLabel}>Style Score</Text>
                <View style={[
                  styles.scoreCircle, 
                  { backgroundColor: analysisResult.outfitScore >= 80 ? COLORS.success : 
                                   analysisResult.outfitScore >= 60 ? COLORS.warning : COLORS.error }
                ]}>
                  <Text style={styles.scoreValue}>{analysisResult.outfitScore}</Text>
                  <Text style={styles.scoreOutOf}>/100</Text>
                </View>
              </View>
            </View>
          </View>

          <Card style={styles.analysisCard}>
            <Text style={styles.analysisTitle}>Style Analysis</Text>
            
            <View style={styles.metricsContainer}>
              <Text style={styles.metricsLabel}>Color Match</Text>
              <ProgressBar 
                progress={analysisResult.colorMatchScore} 
                height={8}
                showPercentage
              />
            </View>
            
            <View style={styles.colorsContainer}>
              <Text style={styles.colorsTitle}>Compatible Colors</Text>
              <View style={styles.colorSwatches}>
                {analysisResult.compatibleColors.map((color, index) => (
                  <View 
                    key={index} 
                    style={[styles.colorSwatch, { backgroundColor: color }]} 
                  />
                ))}
              </View>
            </View>
          </Card>

          <Card style={styles.tipsCard}>
            <View style={styles.tipsHeader}>
              <Text style={styles.tipsTitle}>Style Suggestions</Text>
              <Shirt size={18} color={COLORS.secondary} />
            </View>
            
            {analysisResult.tips.map((tip, index) => (
              <View key={index} style={styles.tipItem}>
                <View style={[styles.tipBullet, { backgroundColor: COLORS.secondary }]}>
                  <Text style={styles.tipBulletText}>{index + 1}</Text>
                </View>
                <Text style={styles.tipText}>{tip}</Text>
              </View>
            ))}
          </Card>

          <View style={styles.actionButtons}>
            <Button
              title="New Analysis"
              onPress={resetAnalysis}
              style={styles.actionButton}
              variant="secondary"
            />
            <Button
              title="Save Results"
              variant="outline"
              onPress={() => {}}
              style={styles.actionButton}
            />
          </View>
        </View>
        )}

        <PremiumModal
          visible={showPremiumModal}
          onClose={() => setShowPremiumModal(false)}
          onSuccess={() => {
            setShowPremiumModal(false);
            console.log('Premium upgrade successful!');
          }}
        />
      </ScrollView>
    </RouteGuard>
  );
}

// Custom hook for camera permissions
function useCameraPermissions() {
  const [permission, requestPermission] = React.useState<{granted: boolean} | null>(null);

  React.useEffect(() => {
    (async () => {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      requestPermission({ granted: status === 'granted' });
    })();
  }, []);

  return [permission, async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    requestPermission({ granted: status === 'granted' });
    return { granted: status === 'granted' };
  }] as const;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  startContainer: {
    padding: 20,
    alignItems: 'center',
  },
  startImage: {
    width: 200,
    height: 200,
    borderRadius: 100,
    marginVertical: 20,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    gap: 12,
  },
  startTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.textDark,
  },
  premiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.gold + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  premiumText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gold,
  },
  premiumCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
  },
  premiumContent: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  premiumIcon: {
    marginRight: 16,
  },
  premiumTextContainer: {
    flex: 1,
  },
  premiumTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textDark,
    marginBottom: 4,
  },
  premiumDescription: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 20,
  },
  premiumButton: {
    width: '100%',
  },
  startDescription: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 30,
    lineHeight: 24,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  button: {
    width: '100%',
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: COLORS.black,
  },
  camera: {
    flex: 1,
    justifyContent: 'space-between',
  },
  cameraOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraGuide: {
    width: 250,
    height: 350,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  cameraGuideFrame: {
    width: 250,
    height: 350,
    borderWidth: 2,
    borderColor: COLORS.white,
    borderRadius: 12,
  },
  cameraInstructions: {
    color: COLORS.white,
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  cameraControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 30,
  },
  cameraButton: {
    padding: 10,
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.white,
  },
  captureButtonDisabled: {
    opacity: 0.5,
  },
  cancelText: {
    color: COLORS.white,
    fontSize: 16,
  },
  outfitSetupContainer: {
    width: '100%',
    alignItems: 'center',
  },
  outfitImage: {
    width: 200,
    height: 280,
    borderRadius: 12,
    marginBottom: 20,
  },
  eventTypeLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textDark,
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  eventTypeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    width: '100%',
    marginBottom: 24,
    gap: 8,
  },
  eventTypeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: COLORS.white,
  },
  eventTypeButtonSelected: {
    backgroundColor: COLORS.secondary,
    borderColor: COLORS.secondary,
  },
  eventTypeEmoji: {
    fontSize: 16,
    marginRight: 6,
  },
  eventTypeButtonText: {
    color: COLORS.textDark,
    fontSize: 14,
    fontWeight: '500',
  },
  eventTypeButtonTextSelected: {
    color: COLORS.white,
    fontWeight: '500',
  },
  loadingContainer: {
    alignItems: 'center',
    marginTop: 20,
  },
  analyzingText: {
    fontSize: 18,
    color: COLORS.textDark,
    marginTop: 16,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 16,
  },
  analyzeButton: {
    flex: 1,
    marginRight: 8,
  },
  changeButton: {
    flex: 1,
    marginLeft: 8,
  },
  resultContainer: {
    padding: 20,
  },
  resultHeader: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  resultImage: {
    width: 120,
    height: 160,
    borderRadius: 12,
    marginRight: 20,
  },
  resultInfo: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  eventTypeResult: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.secondary,
    marginBottom: 16,
  },
  scoreContainer: {
    alignItems: 'center',
  },
  scoreLabel: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 8,
  },
  scoreCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scoreValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  analysisCard: {
    marginBottom: 20,
    padding: 20,
  },
  analysisTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textDark,
    marginBottom: 16,
  },
  metricsContainer: {
    marginBottom: 20,
  },
  metricsLabel: {
    fontSize: 16,
    color: COLORS.textDark,
    marginBottom: 8,
  },
  colorsContainer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 16,
  },
  colorsTitle: {
    fontSize: 16,
    color: COLORS.textDark,
    marginBottom: 12,
  },
  colorSwatches: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  colorSwatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
  },
  tipsCard: {
    marginBottom: 20,
    padding: 20,
  },
  tipsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  tipsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  tipItem: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  tipBullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  tipBulletText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: 'bold',
  },
  tipText: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 24,
  },
  actionButton: {
    flex: 1,
    marginHorizontal: 5,
  },
  
  // Validation styles
  validationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
    gap: 8,
  },
  validationText: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  validationCard: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: COLORS.error + '10',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.error,
  },
  validationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  validationTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.error,
  },
  validationIssue: {
    fontSize: 14,
    color: COLORS.textDark,
    marginBottom: 4,
    lineHeight: 20,
  },
  validationNote: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 8,
    fontStyle: 'italic',
  },
  
  // Camera hints
  cameraHints: {
    marginTop: 16,
    paddingHorizontal: 20,
  },
  cameraHint: {
    color: COLORS.white,
    fontSize: 14,
    marginBottom: 4,
    opacity: 0.8,
  },
  
  // Score circle updates
  scoreOutOf: {
    fontSize: 12,
    color: COLORS.white,
    opacity: 0.8,
  },
  
  // Detected items
  detectedItemsCard: {
    marginBottom: 16,
    padding: 16,
  },
  detectedItemsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  detectedItemsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  detectedItemsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  detectedItem: {
    backgroundColor: COLORS.secondary + '20',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.secondary + '40',
  },
  detectedItemText: {
    fontSize: 14,
    color: COLORS.secondary,
    fontWeight: '500',
  },
  
  // Metrics grid
  metricsGrid: {
    gap: 16,
    marginBottom: 20,
  },
  metricItem: {
    marginBottom: 4,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  metricLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textDark,
  },
  
  // Positive feedback
  positiveCard: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: COLORS.success + '10',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.success,
  },
  positiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  positiveTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.success,
  },
  positiveItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  positiveBullet: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  positiveText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textDark,
    lineHeight: 20,
  },
  
  // Improvement feedback
  improvementCard: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: COLORS.warning + '10',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.warning,
  },
  improvementHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  improvementTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.warning,
  },
  improvementItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  improvementBullet: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  improvementBulletText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: 'bold',
  },
  improvementText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textDark,
    lineHeight: 20,
  },
});