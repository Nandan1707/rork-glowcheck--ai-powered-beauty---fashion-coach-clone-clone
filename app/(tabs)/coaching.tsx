import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, Alert } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Target, CheckCircle, Circle, Calendar, Trophy, Sparkles, Crown } from 'lucide-react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import ProgressBar from '@/components/ProgressBar';
import RouteGuard from '@/components/RouteGuard';
import { COLORS } from '@/constants/colors';
import { aiService, CoachingPlan, DailyTask } from '@/lib/ai-service';
import { useAuth } from '@/hooks/auth-store';
import { useSubscription } from '@/hooks/subscription-store';

export default function CoachingScreen() {
  const { hasCompletedScan, isPremium } = useAuth();
  const { hasPremiumAccess } = useSubscription();
  const params = useLocalSearchParams();
  const [currentPlan, setCurrentPlan] = useState<CoachingPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState('');
  const [showGoalSelection, setShowGoalSelection] = useState(true);
  const [todaysTasks, setTodaysTasks] = useState<DailyTask[]>([]);
  const [currentDay, setCurrentDay] = useState(1);
  const [hasActivePlan, setHasActivePlan] = useState(false);

  const goals = [
    'Improve skin hydration and glow',
    'Reduce acne and blemishes',
    'Anti-aging and wrinkle prevention',
    'Even out skin tone',
    'Develop a consistent skincare routine',
    'Boost overall confidence and beauty',
  ];

  // Check for existing plan and handle auto-generation
  useEffect(() => {
    const checkExistingPlan = async () => {
      try {
        // Check if user has an active glow-up plan
        const currentPlanId = await AsyncStorage.getItem('current-glow-plan');
        if (currentPlanId) {
          const planData = await AsyncStorage.getItem(`glow-plan-${currentPlanId}`);
          if (planData) {
            const plan = JSON.parse(planData);
            setHasActivePlan(true);
            setShowGoalSelection(false);
            // Create a simplified coaching plan from glow-up plan
            const coachingPlan: CoachingPlan = {
              id: plan.id,
              goal: plan.goal,
              duration: 30,
              dailyTasks: [],
              tips: [
                'Stay consistent with your daily routine',
                'Track your progress with photos',
                'Stay hydrated throughout the day',
                'Get adequate sleep for skin recovery'
              ],
              expectedResults: [
                'Improved skin texture and hydration',
                'More consistent skincare habits',
                'Increased confidence in your appearance',
                'Better understanding of your skin needs'
              ]
            };
            setCurrentPlan(coachingPlan);
            return;
          }
        }
        
        // Handle auto-generation from glow analysis
        if (params.autoGenerate === 'true' && params.goal && params.glowScore && hasPremiumAccess) {
          setSelectedGoal(params.goal as string);
          const planGoal = params.goal as string;
          const glowScore = parseInt(params.glowScore as string);
          
          setLoading(true);
          try {
            const plan = await aiService.generateCoachingPlan(planGoal, glowScore);
            setCurrentPlan(plan);
            setShowGoalSelection(false);
          } catch (error) {
            console.error('Error generating coaching plan:', error);
            Alert.alert('Error', 'Failed to generate coaching plan. Please try again.');
          } finally {
            setLoading(false);
          }
        }
      } catch (error) {
        console.error('Error checking existing plan:', error);
      }
    };
    
    checkExistingPlan();
  }, [params, hasPremiumAccess]);

  useEffect(() => {
    if (currentPlan) {
      const today = new Date();
      const planStartDate = new Date(); // In production, store actual start date
      const daysDiff = Math.floor((today.getTime() - planStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const actualDay = Math.min(Math.max(daysDiff, 1), 30);
      
      setCurrentDay(actualDay);
      const tasksForToday = currentPlan.dailyTasks.filter(task => task.day === actualDay);
      setTodaysTasks(tasksForToday);
    }
  }, [currentPlan]);

  const generatePlan = async (goal?: string, glowScore?: number) => {
    const planGoal = goal || selectedGoal;
    
    if (!planGoal) {
      Alert.alert('No Goal Selected', 'Please select a goal before creating your plan.');
      return;
    }
    
    setLoading(true);
    try {
      const plan = await aiService.generateCoachingPlan(planGoal, glowScore || 75);
      setCurrentPlan(plan);
      setShowGoalSelection(false);
      
      // Show success message
      Alert.alert(
        'Plan Created! 🎉',
        'Your personalized 30-day coaching plan has been created successfully. Start your journey today!',
        [{ text: 'Let\'s Go!', style: 'default' }]
      );
    } catch (error) {
      console.error('Error generating coaching plan:', error);
      Alert.alert(
        'Error Creating Plan',
        'Failed to generate coaching plan. Please check your connection and try again.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Retry', onPress: () => generatePlan(goal, glowScore) }
        ]
      );
    } finally {
      setLoading(false);
    }
  };

  const toggleTaskCompletion = (taskId: string) => {
    if (!currentPlan) return;
    
    const updatedTasks = currentPlan.dailyTasks.map(task =>
      task.id === taskId ? { ...task, completed: !task.completed } : task
    );
    
    setCurrentPlan({ ...currentPlan, dailyTasks: updatedTasks });
    setTodaysTasks(prev => prev.map(task =>
      task.id === taskId ? { ...task, completed: !task.completed } : task
    ));
  };

  const getCompletionRate = () => {
    if (!currentPlan) return 0;
    const completedTasks = currentPlan.dailyTasks.filter(task => task.completed).length;
    return Math.round((completedTasks / currentPlan.dailyTasks.length) * 100);
  };

  const getTodayCompletionRate = () => {
    if (todaysTasks.length === 0) return 0;
    const completedToday = todaysTasks.filter(task => task.completed).length;
    return Math.round((completedToday / todaysTasks.length) * 100);
  };

  const resetPlan = () => {
    setCurrentPlan(null);
    setShowGoalSelection(true);
    setSelectedGoal('');
    setTodaysTasks([]);
  };



  const renderTask = ({ item }: { item: DailyTask }) => (
    <TouchableOpacity
      style={[styles.taskItem, item.completed && styles.taskCompleted]}
      onPress={() => toggleTaskCompletion(item.id)}
    >
      <View style={styles.taskIcon}>
        {item.completed ? (
          <CheckCircle size={24} color={COLORS.success} />
        ) : (
          <Circle size={24} color={COLORS.textLight} />
        )}
      </View>
      <View style={styles.taskContent}>
        <Text style={[styles.taskTitle, item.completed && styles.taskTitleCompleted]}>
          {item.title}
        </Text>
        <Text style={[styles.taskDescription, item.completed && styles.taskDescriptionCompleted]}>
          {item.description}
        </Text>
        <View style={styles.taskMeta}>
          <Text style={styles.taskType}>{item.type.toUpperCase()}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  // Show scan prompt if user hasn't completed scan
  if (!hasCompletedScan) {
    return (
      <ScrollView style={styles.container}>
        <Stack.Screen options={{ title: 'Beauty Coaching' }} />
        
        <View style={styles.scanPromptContainer}>
          <View style={styles.scanPromptContent}>
            <Sparkles size={48} color={COLORS.primary} />
            <Text style={styles.scanPromptTitle}>Scan Before Your Plan Starts</Text>
            <Text style={styles.scanPromptDescription}>
              Complete your glow scan to unlock your personalized 30-day coaching plan and start your beauty journey.
            </Text>
            <Button
              title="Start Glow Scan"
              onPress={() => router.push('/(tabs)/glow-analysis')}
              leftIcon={<Target size={18} color={COLORS.white} />}
              style={styles.scanPromptButton}
            />
          </View>
        </View>
      </ScrollView>
    );
  }

  // Show active plan progress if user has one
  if (hasActivePlan && currentPlan) {
    return (
      <ScrollView style={styles.container}>
        <Stack.Screen options={{ title: 'Beauty Coaching' }} />
        
        <View style={styles.activePlanContainer}>
          <Card style={styles.activePlanCard} gradient>
            <View style={styles.activePlanHeader}>
              <View style={styles.activePlanTitleContainer}>
                <Sparkles size={24} color={COLORS.primary} />
                <Text style={styles.activePlanTitle}>Your 30-Day Glow-Up Plan Progress</Text>
              </View>
              {isPremium && (
                <View style={styles.premiumBadge}>
                  <Crown size={16} color={COLORS.gold} />
                  <Text style={styles.premiumText}>Premium</Text>
                </View>
              )}
            </View>
            
            <Text style={styles.activePlanGoal}>{currentPlan.goal}</Text>
            
            <View style={styles.activePlanProgress}>
              <Text style={styles.activePlanProgressLabel}>Day {currentDay} of 30</Text>
              <ProgressBar 
                progress={(currentDay / 30) * 100} 
                height={8}
                style={styles.activePlanProgressBar}
              />
            </View>
            
            <Button
              title="Continue Plan"
              onPress={() => router.push('/(tabs)/glow-plan')}
              style={styles.activePlanButton}
              leftIcon={<Target size={18} color={COLORS.white} />}
            />
          </Card>
          
          <Card style={styles.tipsCard}>
            <View style={styles.tipsHeader}>
              <Trophy size={20} color={COLORS.secondary} />
              <Text style={styles.tipsTitle}>Today&apos;s Tips</Text>
            </View>
            
            {currentPlan.tips.slice(0, 3).map((tip, index) => (
              <View key={index} style={styles.tipItem}>
                <View style={styles.tipBullet}>
                  <Text style={styles.tipBulletText}>{index + 1}</Text>
                </View>
                <Text style={styles.tipText}>{tip}</Text>
              </View>
            ))}
          </Card>
        </View>
      </ScrollView>
    );
  }

  if (showGoalSelection) {
    return (
      <RouteGuard requireAuth requirePremium>
        <ScrollView style={styles.container}>
          <Stack.Screen options={{ title: 'Beauty Coaching' }} />
          
          <View style={styles.goalSelectionContainer}>
            <View style={styles.headerContainer}>
              <View style={styles.titleContainer}>
                <Sparkles size={32} color={COLORS.primary} />
                <Text style={styles.title}>Your Beauty Journey</Text>
                {hasPremiumAccess && (
                  <View style={styles.premiumBadge}>
                    <Crown size={16} color={COLORS.gold} />
                    <Text style={styles.premiumText}>Premium</Text>
                  </View>
                )}
              </View>
              <Text style={styles.subtitle}>
                Choose your goal and get a personalized 30-day coaching plan
              </Text>
            </View>

            <Card style={styles.goalCard}>
              <Text style={styles.goalCardTitle}>What&apos;s your main goal?</Text>
              
              {goals.map((goal, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.goalOption,
                    selectedGoal === goal && styles.goalOptionSelected,
                  ]}
                  onPress={() => setSelectedGoal(goal)}
                >
                  <View style={[
                    styles.goalRadio,
                    selectedGoal === goal && styles.goalRadioSelected,
                  ]}>
                    {selectedGoal === goal && <View style={styles.goalRadioInner} />}
                  </View>
                  <Text style={[
                    styles.goalText,
                    selectedGoal === goal && styles.goalTextSelected,
                  ]}>
                    {goal}
                  </Text>
                </TouchableOpacity>
              ))}
            </Card>

            <Button
              title={loading ? 'Generating Plan...' : 'Create My Plan'}
              onPress={() => generatePlan()}
              disabled={!selectedGoal || loading}
              isLoading={loading}
              style={styles.generateButton}
              leftIcon={<Target size={18} color={COLORS.white} />}
              testID="create-my-plan-button"
            />
          </View>
        </ScrollView>
      </RouteGuard>
    );
  }

  if (!currentPlan) return null;

  return (
    <RouteGuard requireAuth requirePremium>
      <ScrollView style={styles.container}>
      <Stack.Screen 
        options={{ 
          title: 'My Coaching Plan',
          headerRight: () => (
            <TouchableOpacity onPress={resetPlan} style={styles.resetButton}>
              <Text style={styles.resetButtonText}>New Plan</Text>
            </TouchableOpacity>
          ),
        }} 
      />

      <View style={styles.planContainer}>
        <Card style={styles.progressCard} gradient>
          <View style={styles.progressHeader}>
            <View>
              <Text style={styles.progressTitle}>Day {currentDay} of 30</Text>
              <Text style={styles.progressGoal}>{currentPlan.goal}</Text>
            </View>
            <View style={styles.progressStats}>
              <Text style={styles.progressPercentage}>{getCompletionRate()}%</Text>
              <Text style={styles.progressLabel}>Complete</Text>
            </View>
          </View>
          <ProgressBar 
            progress={getCompletionRate()} 
            height={8}
            style={styles.progressBar}
          />
        </Card>

        <Card style={styles.todayCard}>
          <View style={styles.todayHeader}>
            <View style={styles.todayTitleContainer}>
              <Calendar size={20} color={COLORS.primary} />
              <Text style={styles.todayTitle}>Today&apos;s Tasks</Text>
            </View>
            <View style={styles.todayProgress}>
              <Text style={styles.todayProgressText}>
                {todaysTasks.filter(t => t.completed).length}/{todaysTasks.length}
              </Text>
            </View>
          </View>
          
          <ProgressBar 
            progress={getTodayCompletionRate()} 
            height={6}
            style={styles.todayProgressBar}
          />

          <FlatList
            data={todaysTasks}
            renderItem={renderTask}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            style={styles.tasksList}
          />
        </Card>

        <Card style={styles.tipsCard}>
          <View style={styles.tipsHeader}>
            <Trophy size={20} color={COLORS.secondary} />
            <Text style={styles.tipsTitle}>Pro Tips</Text>
          </View>
          
          {currentPlan.tips.map((tip, index) => (
            <View key={index} style={styles.tipItem}>
              <View style={styles.tipBullet}>
                <Text style={styles.tipBulletText}>{index + 1}</Text>
              </View>
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ))}
        </Card>

        <Card style={styles.resultsCard}>
          <Text style={styles.resultsTitle}>Expected Results</Text>
          
          {currentPlan.expectedResults.map((result, index) => (
            <View key={index} style={styles.resultItem}>
              <CheckCircle size={16} color={COLORS.success} />
              <Text style={styles.resultText}>{result}</Text>
            </View>
          ))}
        </Card>
      </View>
      </ScrollView>
    </RouteGuard>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  goalSelectionContainer: {
    padding: 16,
  },
  scanPromptContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    minHeight: 400,
  },
  scanPromptContent: {
    alignItems: 'center',
    maxWidth: 300,
  },
  scanPromptTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.textDark,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 12,
  },
  scanPromptDescription: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  scanPromptButton: {
    width: '100%',
  },
  activePlanContainer: {
    padding: 16,
  },
  activePlanCard: {
    marginBottom: 16,
    padding: 20,
  },
  activePlanHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  activePlanTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  activePlanTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textDark,
    marginLeft: 8,
    flex: 1,
  },
  activePlanGoal: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 16,
    lineHeight: 22,
  },
  activePlanProgress: {
    marginBottom: 16,
  },
  activePlanProgressLabel: {
    fontSize: 14,
    color: COLORS.textDark,
    marginBottom: 8,
    fontWeight: '500',
  },
  activePlanProgressBar: {
    marginBottom: 4,
  },
  activePlanButton: {
    width: '100%',
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  premiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.gold + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  premiumText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gold,
    marginLeft: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.textDark,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 24,
  },
  goalCard: {
    marginBottom: 30,
    padding: 20,
  },
  goalCardTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textDark,
    marginBottom: 20,
  },
  goalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  goalOptionSelected: {
    backgroundColor: COLORS.primary + '10',
  },
  goalRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.border,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  goalRadioSelected: {
    borderColor: COLORS.primary,
  },
  goalRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
  goalText: {
    flex: 1,
    fontSize: 16,
    color: COLORS.textDark,
  },
  goalTextSelected: {
    color: COLORS.primary,
    fontWeight: '500',
  },
  generateButton: {
    width: '100%',
  },
  resetButton: {
    marginRight: 16,
  },
  resetButtonText: {
    color: COLORS.primary,
    fontSize: 16,
    fontWeight: '500',
  },
  planContainer: {
    padding: 16,
  },
  progressCard: {
    marginBottom: 16,
    padding: 20,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  progressTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.textDark,
    marginBottom: 4,
  },
  progressGoal: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  progressStats: {
    alignItems: 'center',
  },
  progressPercentage: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  progressLabel: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  progressBar: {
    marginTop: 8,
  },
  todayCard: {
    marginBottom: 16,
    padding: 20,
  },
  todayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  todayTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  todayTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textDark,
    marginLeft: 8,
  },
  todayProgress: {
    backgroundColor: COLORS.primary + '20',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  todayProgressText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  todayProgressBar: {
    marginBottom: 16,
  },
  tasksList: {
    maxHeight: 300,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  taskCompleted: {
    backgroundColor: COLORS.success + '10',
    borderColor: COLORS.success + '30',
  },
  taskIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.textDark,
    marginBottom: 4,
  },
  taskTitleCompleted: {
    textDecorationLine: 'line-through',
    color: COLORS.textLight,
  },
  taskDescription: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 20,
    marginBottom: 8,
  },
  taskDescriptionCompleted: {
    textDecorationLine: 'line-through',
  },
  taskMeta: {
    flexDirection: 'row',
  },
  taskType: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.primary,
    backgroundColor: COLORS.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  tipsCard: {
    marginBottom: 16,
    padding: 20,
  },
  tipsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  tipsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textDark,
    marginLeft: 8,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  tipBullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  tipBulletText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: 'bold',
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
  },
  resultsCard: {
    marginBottom: 24,
    padding: 20,
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textDark,
    marginBottom: 16,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  resultText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    marginLeft: 12,
    lineHeight: 20,
  },
});