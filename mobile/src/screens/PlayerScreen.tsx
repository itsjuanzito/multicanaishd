import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StatusBar, 
  useWindowDimensions,
  TouchableWithoutFeedback,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Video, AVPlaybackStatus } from 'expo-av';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as NavigationBar from 'expo-navigation-bar';
import { supabase } from '../services/supabase';
import { WebViewPlayer } from '../components/WebViewPlayer';
import { NativePlayer } from '../components/NativePlayer';
import { styles } from './PlayerScreen.styles';
type PlayerScreenRouteProp = RouteProp<{
  params: {
    streamUrl?: string;
    title: string;
    category: string;
    isEmbed?: boolean;
    id?: string;
    mediaType?: 'movie' | 'series' | 'tv';
    season?: string;
    episode?: string;
  };
}, 'params'>;
const SOURCES = [
  { id: 'server2', name: 'VIP Diamond 💎' },
  { id: 'source2', name: 'VIP Básico ⚡' },
  { id: 'source1', name: 'Principal 🎬' },
  { id: 'source3', name: 'Opção 2 🎥' },
  { id: 'source4', name: 'Opção 3 📺' }
];
const formatTime = (ms: number): string => {
  if (isNaN(ms) || ms < 0) return '00:00';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
};
function PlayerScreen() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const navigation = useNavigation();
  const route = useRoute<PlayerScreenRouteProp>();
  const { 
    streamUrl: initialStreamUrl, 
    title, 
    category, 
    isEmbed: initialIsEmbed, 
    id, 
    mediaType, 
    season, 
    episode 
  } = route.params || {};
  const videoRef = useRef<Video>(null);
  useEffect(() => {
    async function lockOrientation() {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        if (Platform.OS === 'android') {
          await NavigationBar.setVisibilityAsync('hidden');
          await NavigationBar.setBehaviorAsync('overlay-swipe');
        }
      } catch (err) {
        console.warn('[Player] Orientation/NavBar lock error:', err);
      }
    }
    lockOrientation();
    return () => {
      async function restoreOrientation() {
        try {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
          if (Platform.OS === 'android') {
            await NavigationBar.setVisibilityAsync('visible');
          }
        } catch (err) {
          console.warn('[Player] Orientation/NavBar restore error:', err);
        }
      }
      restoreOrientation();
    };
  }, []);
  const [selectedSource, setSelectedSource] = useState('server2');
  const [resolvedUrl, setResolvedUrl] = useState(initialStreamUrl || '');
  const [isEmbedState, setIsEmbedState] = useState(!!initialIsEmbed);
  const [webPlayerUrl, setWebPlayerUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isSourcesDrawerOpen, setIsSourcesDrawerOpen] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(1); // Avoid division by zero
  const [webViewHeaderVisible, setWebViewHeaderVisible] = useState(true);
  const [progressBarWidth, setProgressBarWidth] = useState(0);
  const handleSkipForward = useCallback(async () => {
    if (isEmbedState || !videoRef.current) return;
    const newPosition = Math.min(position + 10000, duration);
    await videoRef.current.setPositionAsync(newPosition);
    setPosition(newPosition);
  }, [position, duration, isEmbedState]);
  const handleSkipBackward = useCallback(async () => {
    if (isEmbedState || !videoRef.current) return;
    const newPosition = Math.max(position - 10000, 0);
    await videoRef.current.setPositionAsync(newPosition);
    setPosition(newPosition);
  }, [position, isEmbedState]);
  const handleProgressBarPress = useCallback(async (event: any) => {
    if (isEmbedState || !videoRef.current || duration <= 0 || progressBarWidth <= 0) return;
    const { locationX } = event.nativeEvent;
    const percentage = Math.min(Math.max(locationX / progressBarWidth, 0), 1);
    const newPosition = Math.floor(percentage * duration);
    await videoRef.current.setPositionAsync(newPosition);
    setPosition(newPosition);
  }, [duration, progressBarWidth, isEmbedState]);
  useEffect(() => {
    if (!id) {
      setResolvedUrl(initialStreamUrl || '');
      setIsEmbedState(!!initialIsEmbed);
      setIsLoading(false);
      setFetchError(null);
      return;
    }
    let active = true;
    async function resolveSource() {
      setIsLoading(true);
      setFetchError(null);
      const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL || 'https://multicanaishd.lol';
      const normalizedType = (mediaType === 'tv' || mediaType === 'series') ? 'series' : 'movie';
      const fetchUrl = `${apiBaseUrl}/api/admin/get-source?id=${id}&type=${normalizedType}&source=${selectedSource}&season=${season || '1'}&episode=${episode || '1'}&lang=pt`;
      try {
        console.log(`[Player] Resolving VOD source at: ${fetchUrl}`);
        // Sem este header o app leva 403 em TODA fonte: diferente do site, a chamada do
        // React Native não manda Referer, então não passa nem pela camada de "domínio
        // oficial" do get-source — e o gate de fonte premium só reconhece o Bearer.
        // `getSession()` renova o access_token vencido antes de devolver.
        let authHeaders: Record<string, string> = {};
        try {
          const { data } = await supabase.auth.getSession();
          const accessToken = data?.session?.access_token;
          if (accessToken) authHeaders = { Authorization: `Bearer ${accessToken}` };
        } catch (authErr) {
          console.warn('[Player] Falha ao obter sessão para o header de acesso:', authErr);
        }
        const response = await fetch(fetchUrl, { headers: authHeaders });
        if (!response.ok) {
          throw new Error(`Erro HTTP: ${response.status}`);
        }
        const data = await response.json();
        if (!active) return;
        if (data && data.url) {
          const finalUrl = data.url;
          const absoluteWebUrl = finalUrl.startsWith('/') ? `${apiBaseUrl}${finalUrl}` : finalUrl;
          let isEmbedUrl = true;
          let urlToPlay = absoluteWebUrl;
          if (selectedSource === 'server2' && finalUrl.includes('url=')) {
            const urlParam = finalUrl.split('url=')[1]?.split('&')[0];
            if (urlParam) {
              const decoded = decodeURIComponent(urlParam);
              const isDirectStream = decoded && decoded.startsWith('http') && 
                                     !/streamtape|vidmoly|fembed|embed|iframe/.test(decoded);
              if (isDirectStream) {
                isEmbedUrl = false;
                urlToPlay = decoded;
              }
            }
          }
          setResolvedUrl(urlToPlay);
          setIsEmbedState(isEmbedUrl);
          setWebPlayerUrl(absoluteWebUrl);
        } else {
          throw new Error('Nenhuma URL retornada pela API.');
        }
      } catch (err: any) {
        if (active) {
          console.error('[Player] Error resolving stream:', err);
          setFetchError('Não foi possível conectar com o servidor. Tente trocar de opção.');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }
    resolveSource();
    return () => {
      active = false;
    };
  }, [id, selectedSource, season, episode, initialStreamUrl, initialIsEmbed, mediaType]);
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    const isVisible = isEmbedState ? webViewHeaderVisible : controlsVisible;
    if (isVisible && isPlaying) {
      timeout = setTimeout(() => {
        if (isEmbedState) {
          setWebViewHeaderVisible(false);
        } else {
          setControlsVisible(false);
        }
      }, 4000);
    }
    return () => clearTimeout(timeout);
  }, [controlsVisible, webViewHeaderVisible, isPlaying, isEmbedState]);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const isVisible = isEmbedState ? webViewHeaderVisible : controlsVisible;
    let timeout: NodeJS.Timeout;
    async function syncSystemBars() {
      try {
        if (isVisible) {
          await NavigationBar.setVisibilityAsync('visible');
        } else {
          await NavigationBar.setVisibilityAsync('hidden');
          await NavigationBar.setBehaviorAsync('overlay-swipe');
        }
      } catch (err) {
        console.warn('[Player] System bars sync error:', err);
      }
    }
    syncSystemBars();
    const subscription = NavigationBar.addVisibilityListener(({ visibility }) => {
      if (visibility === 'visible' && !isVisible) {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(async () => {
          try {
            await NavigationBar.setVisibilityAsync('hidden');
          } catch (_) {}
        }, 3500);
      }
    });
    return () => {
      subscription.remove();
      if (timeout) clearTimeout(timeout);
    };
  }, [controlsVisible, webViewHeaderVisible, isEmbedState]);
  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);
  const handleTogglePlay = useCallback(async () => {
    if (isEmbedState || !videoRef.current) return;
    if (isPlaying) {
      await videoRef.current.pauseAsync();
      setIsPlaying(false);
      setControlsVisible(true);
    } else {
      await videoRef.current.playAsync();
      setIsPlaying(true);
    }
  }, [isPlaying, isEmbedState]);
  const handleScreenTap = useCallback(() => {
    if (isEmbedState) return;
    setControlsVisible(prev => !prev);
  }, [isEmbedState]);
  const handlePlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      if (status.error) {
        console.error('Erro de reprodução nativa:', status.error);
        if (webPlayerUrl) {
          console.log('[Player] Falling back seamlessly to WebView player at:', webPlayerUrl);
          setResolvedUrl(webPlayerUrl);
          setIsEmbedState(true);
        } else {
          setFetchError('Erro de reprodução nativa e nenhum fallback disponível.');
        }
      }
      return;
    }
    setIsLoading(status.isBuffering);
    setPosition(status.positionMillis);
    if (status.durationMillis) {
      setDuration(status.durationMillis);
    }
    if (status.didJustFinish) {
      setIsPlaying(false);
      setControlsVisible(true);
      setPosition(0);
      videoRef.current?.setPositionAsync(0);
    }
  }, [webPlayerUrl]);
  const progressPercent = duration > 0 ? (position / duration) * 100 : 0;
  const streamHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://multicanaishd.lol/'
  };
  if (fetchError) {
    return (
      <View style={styles.container}>
        <StatusBar hidden={true} />
        <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
          <Text style={styles.backButtonText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Erro de Transmissão</Text>
          <Text style={styles.errorText}>{fetchError}</Text>
          {id && (
            <View style={styles.errorServersContainer}>
              <Text style={styles.errorServersLabel}>Tente outro servidor disponível:</Text>
              <View style={styles.errorServersRow}>
                {SOURCES.map(source => (
                  <TouchableOpacity
                    key={source.id}
                    style={[
                      styles.serverPill,
                      selectedSource === source.id && styles.serverPillActive
                    ]}
                    onPress={() => setSelectedSource(source.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={[
                      styles.serverPillText,
                      selectedSource === source.id && styles.serverPillTextActive
                    ]}>
                      {source.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>
      </View>
    );
  }
  const renderSourcesDrawer = () => {
    if (!isSourcesDrawerOpen) return null;
    return (
      <View style={styles.sourcesBackdrop} pointerEvents="auto">
        <TouchableWithoutFeedback onPress={() => setIsSourcesDrawerOpen(false)}>
          <View style={StyleSheet.absoluteFillObject} />
        </TouchableWithoutFeedback>
        <View style={styles.sourcesDrawerContainer}>
          <View style={styles.drawerHeader}>
            <Text style={styles.sourcesDrawerTitle}>FONTES DISPONÍVEIS</Text>
            <TouchableOpacity 
              style={styles.closeDrawerBtn} 
              onPress={() => setIsSourcesDrawerOpen(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.closeDrawerBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView 
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.drawerScrollViewContent}
          >
            <Text style={styles.drawerSubtitle}>
              Se o player travar ou apresentar falhas, selecione uma transmissão alternativa abaixo:
            </Text>
            {SOURCES.map((source) => {
              const isActive = selectedSource === source.id;
              const isDirect = source.id === 'server2';
              return (
                <TouchableOpacity
                  key={source.id}
                  style={[
                    styles.drawerServerPill,
                    isActive && styles.drawerServerPillActive
                  ]}
                  onPress={() => {
                    setSelectedSource(source.id);
                    setIsSourcesDrawerOpen(false);
                  }}
                  activeOpacity={0.8}
                >
                  <View style={styles.drawerServerInfo}>
                    <Text style={[
                      styles.drawerServerName,
                      isActive && styles.drawerServerNameActive
                    ]}>
                      {source.name}
                    </Text>
                    <View style={styles.drawerBadgeRow}>
                      <View style={[
                        styles.drawerBadge,
                        isDirect ? styles.drawerBadgeNative : styles.drawerBadgeWeb
                      ]}>
                        <Text style={styles.drawerBadgeText}>
                          {isDirect ? 'VIP Diamond • Nativo' : 'Opção Embed • Web'}
                        </Text>
                      </View>
                      {isActive && (
                        <View style={styles.drawerActiveBadge}>
                          <Text style={styles.drawerActiveBadgeText}>ATIVO</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <Text style={[
                    styles.drawerArrow,
                    isActive && { color: '#FF5555' }
                  ]}>
                    {isActive ? '●' : '›'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    );
  };
  return (
    <View style={styles.container}>
      <StatusBar hidden={true} />
      {isLoading && resolvedUrl === '' ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#FF5555" />
          <Text style={styles.loadingText}>Conectando transmissão...</Text>
        </View>
      ) : isEmbedState ? (
        <WebViewPlayer
          resolvedUrl={resolvedUrl}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
          setFetchError={setFetchError}
          webViewHeaderVisible={webViewHeaderVisible}
          setWebViewHeaderVisible={setWebViewHeaderVisible}
          handleGoBack={handleGoBack}
          title={title}
          category={category}
          id={id}
          isLandscape={isLandscape}
          onOpenSources={() => setIsSourcesDrawerOpen(true)}
        />
      ) : (
        <NativePlayer
          videoRef={videoRef}
          resolvedUrl={resolvedUrl}
          streamHeaders={streamHeaders}
          isPlaying={isPlaying}
          handlePlaybackStatusUpdate={handlePlaybackStatusUpdate}
          isLoading={isLoading}
          handleScreenTap={handleScreenTap}
          controlsVisible={controlsVisible}
          isLandscape={isLandscape}
          handleGoBack={handleGoBack}
          title={title}
          category={category}
          id={id}
          onOpenSources={() => setIsSourcesDrawerOpen(true)}
          handleSkipBackward={handleSkipBackward}
          handleSkipForward={handleSkipForward}
          handleTogglePlay={handleTogglePlay}
          setProgressBarWidth={setProgressBarWidth}
          handleProgressBarPress={handleProgressBarPress}
          progressPercent={progressPercent}
          position={position}
          duration={duration}
          formatTime={formatTime}
        />
      )}
      {/* Render the sources drawer on top of all players */}
      {id && renderSourcesDrawer()}
    </View>
  );
}
export default React.memo(PlayerScreen);