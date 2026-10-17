import React, { useState, useEffect, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  Text,
  View,
  TouchableOpacity,
  Platform,
  ScrollView
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as NavigationBar from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from './src/screens/HomeScreen';
import DetailsScreen from './src/screens/DetailsScreen';
import PlayerScreen from './src/screens/PlayerScreen';
import SearchScreen from './src/screens/SearchScreen';
import LoginScreen from './src/screens/LoginScreen';
import LoadingScreen from './src/components/LoadingScreen';
import Avatar from './src/components/Avatar';
import { useAuthStore } from './src/store/authStore';
import { supabase } from './src/services/supabase';
import { getAvatarUrl, formatVipPlan } from './src/utils/profile';
import { styles } from './App.styles';

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

export default function App() {
  const { session, profile, loading: authLoading, isAuthenticated, isVIP } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [exploreOpen, setExploreOpen] = useState(false);
  const [language, setLanguage] = useState<'pt' | 'en'>('pt');

  useEffect(() => {
    SystemUI.setBackgroundColorAsync('#050505').catch(() => {});

    if (Platform.OS === 'android') {
      try {
        NavigationBar.setBackgroundColorAsync('#050505');
        NavigationBar.setButtonStyleAsync('light');
      } catch (err) {
        // Silencia erros
      }
    }
  }, []);

  const openMenu = useCallback(() => {
    setMenuOpen(true);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    setMenuOpen(false);
  }, []);

  const handleAuthAction = useCallback(() => {
    setMenuOpen(false);
    if (isAuthenticated) {
      handleLogout();
    } else if (navigationRef.isReady()) {
      navigationRef.navigate('Login' as never);
    }
  }, [isAuthenticated, handleLogout]);

  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTab(tabId);
    setMenuOpen(false);
    if (tabId === 'profile') {
      const statusLabel = isVIP ? `${formatVipPlan(profile?.vip_plan)} 💎` : 'Membro Standard';
      alert(`👤 Meu Perfil MultiCanaisHD\n\nNome: ${profile?.username || 'Visitante'}\nStatus: ${statusLabel}\n\nE-mail: ${profile?.email || '—'}`);
    }
  }, [isVIP, profile]);

  const menuItems = [
    { id: 'home', name: 'Início' },
    { id: 'movies', name: 'Filmes' },
    { id: 'series', name: 'Séries' },
    { id: 'animes', name: 'Animes' },
    { id: 'channels', name: 'Canais de TV' },
    { id: 'ranking', name: 'Ranking' },
    { id: 'calendar', name: 'Calendário' },
  ];

  const exploreItems = [
    { id: 'agenda', name: 'Agenda' },
    { id: 'status', name: 'Status' },
    { id: 'support', name: 'Suporte' },
    { id: 'api', name: 'API' },
    { id: 'changelog', name: 'Changelog' },
    { id: 'watchparty', name: 'Watch Party' },
  ];

  const toggleExplore = useCallback(() => {
    setExploreOpen(prev => !prev);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(prev => (prev === 'pt' ? 'en' : 'pt'));
  }, []);

  if (authLoading) {
    return (
      <SafeAreaProvider>
        <LoadingScreen />
      </SafeAreaProvider>
    );
  }

  const displayName = profile?.username || (session?.user?.email ? session.user.email.split('@')[0] : 'Visitante');
  const avatarInitials = displayName.slice(0, 2).toUpperCase();
  const avatarUrl = getAvatarUrl(profile?.avatar);
  const vipStatusLabel = isVIP ? formatVipPlan(profile?.vip_plan) : 'Membro Standard';

  return (
    <SafeAreaProvider>
      <View style={styles.rootContainer}>
        <StatusBar style="light" translucent={true} backgroundColor="transparent" />

        <View style={styles.contentContainer}>
          <NavigationContainer ref={navigationRef}>
            <Stack.Navigator
              initialRouteName="Home"
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: '#050505' }
              }}
            >
              <Stack.Screen name="Home">
                {props => (
                  <HomeScreen
                    {...props}
                    isVIP={isVIP}
                    isAuthenticated={isAuthenticated}
                    userId={session?.user?.id}
                    onLogout={handleLogout}
                    onOpenMenu={openMenu}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="Details" component={DetailsScreen} />
              <Stack.Screen name="Player" component={PlayerScreen} />
              <Stack.Screen name="Search" component={SearchScreen} />
              <Stack.Screen name="Login">
                {props => (
                  <LoginScreen
                    {...props}
                    onAuthenticated={() => props.navigation.goBack()}
                    onContinueAsGuest={() => props.navigation.goBack()}
                  />
                )}
              </Stack.Screen>
            </Stack.Navigator>
          </NavigationContainer>
        </View>

        {/* Menu Lateral: sem animação, aparece/some direto */}
        {menuOpen && (
          <View style={styles.drawerRoot}>
            <TouchableOpacity
              style={styles.drawerOverlay}
              activeOpacity={1}
              onPress={closeMenu}
            />

            <View style={styles.drawerContainer}>
              <View style={styles.drawerHeader}>
                <Text style={styles.drawerLogoText}>MULTI<Text style={styles.logoRed}>FLIX</Text></Text>
                <TouchableOpacity style={styles.closeButton} onPress={closeMenu}>
                  <Text style={styles.closeButtonText}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.drawerScroll} showsVerticalScrollIndicator={false}>

                <TouchableOpacity
                  style={styles.drawerProfileCard}
                  onPress={() => handleSelectTab('profile')}
                  activeOpacity={0.8}
                >
                  <View style={styles.profileAvatarContainer}>
                    <Avatar
                      url={avatarUrl}
                      initials={avatarInitials}
                      size={44}
                      style={styles.profileAvatarText}
                    />
                    {isVIP && (
                      <View style={styles.profileVipBadge}>
                        <Text style={styles.profileVipBadgeText}>💎</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.profileInfoContainer}>
                    <Text style={styles.profileName}>{displayName}</Text>
                    <Text style={[
                      styles.profileStatusText,
                      isVIP ? styles.profileStatusVip : styles.profileStatusStandard
                    ]}>
                      {isAuthenticated ? vipStatusLabel : 'Modo Visitante'}
                    </Text>
                  </View>
                </TouchableOpacity>

                <Text style={styles.drawerSectionTitle}>Navegação</Text>
                {menuItems.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.drawerItem, activeTab === item.id && styles.drawerItemActive]}
                    onPress={() => handleSelectTab(item.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.drawerItemText, activeTab === item.id && styles.drawerItemTextActive]}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                ))}

                {isAuthenticated && (
                  <TouchableOpacity
                    style={[styles.drawerItem, activeTab === 'mylist' && styles.drawerItemActive]}
                    onPress={() => handleSelectTab('mylist')}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.drawerItemText, activeTab === 'mylist' && styles.drawerItemTextActive]}>
                      Minha Lista
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.drawerItem}
                  onPress={toggleExplore}
                  activeOpacity={0.7}
                >
                  <Text style={styles.drawerItemText}>Explorar</Text>
                  <Feather
                    name={exploreOpen ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color="#8A8A8A"
                    style={styles.drawerChevron}
                  />
                </TouchableOpacity>

                {exploreOpen && exploreItems.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.drawerSubItem}
                    onPress={() => {}}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.drawerItemText}>{item.name}</Text>
                  </TouchableOpacity>
                ))}

                <View style={styles.drawerSeparator} />

                <TouchableOpacity
                  style={styles.drawerLogoutBtn}
                  onPress={handleAuthAction}
                  activeOpacity={0.7}
                >
                  <Text style={styles.drawerLogoutText}>
                    {isAuthenticated ? 'Sair da Conta' : 'Entrar / Criar Conta'}
                  </Text>
                </TouchableOpacity>

                <View style={styles.drawerQuickActions}>
                  <TouchableOpacity
                    style={styles.drawerQuickActionBtn}
                    onPress={toggleLanguage}
                    activeOpacity={0.7}
                  >
                    <Feather name="globe" size={16} color="#FFFFFF" />
                    <Text style={styles.drawerQuickActionText}>
                      {language === 'pt' ? 'PT' : 'EN'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.drawerQuickActionBtn}
                    onPress={() => {}}
                    activeOpacity={0.7}
                  >
                    <Feather name="message-circle" size={16} color="#FFFFFF" />
                    <Text style={styles.drawerQuickActionText}>Discord</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.drawerQuickActionBtn}
                    onPress={() => {}}
                    activeOpacity={0.7}
                  >
                    <Feather name="send" size={16} color="#FFFFFF" />
                    <Text style={styles.drawerQuickActionText}>Telegram</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        )}
      </View>
    </SafeAreaProvider>
  );
}
