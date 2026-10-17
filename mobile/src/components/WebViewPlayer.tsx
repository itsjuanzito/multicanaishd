import React from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  ActivityIndicator, 
  ScrollView,
  Linking
} from 'react-native';
import { WebView } from 'react-native-webview';
import { LinearGradient } from 'expo-linear-gradient';
import { styles } from '../screens/PlayerScreen.styles';

interface WebViewPlayerProps {
  resolvedUrl: string;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  setFetchError: (error: string | null) => void;
  webViewHeaderVisible: boolean;
  setWebViewHeaderVisible: (visible: boolean) => void;
  handleGoBack: () => void;
  title: string;
  category: string;
  id?: string;
  isLandscape: boolean;
  onOpenSources: () => void;
}

export const WebViewPlayer: React.FC<WebViewPlayerProps> = ({
  resolvedUrl,
  isLoading,
  setIsLoading,
  setFetchError,
  webViewHeaderVisible,
  setWebViewHeaderVisible,
  handleGoBack,
  title,
  category,
  id,
  isLandscape,
  onOpenSources,
}) => {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            background-color: #000000;
            overflow: hidden;
          }
          iframe {
            width: 100%;
            height: 100%;
            border: none;
            position: absolute;
            top: 0;
            left: 0;
          }
        </style>
      </head>
      <body>
        <iframe 
          src="${resolvedUrl}" 
          allowfullscreen="true" 
          webkitallowfullscreen="true" 
          mozallowfullscreen="true" 
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        ></iframe>
      </body>
    </html>
  `;

  return (
    <View style={{ flex: 1, position: 'relative', backgroundColor: '#050505' }}>
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#FF5555" />
          <Text style={styles.loadingText}>Conectando transmissão...</Text>
        </View>
      )}

      <WebView
        source={{ 
          html: htmlContent,
          baseUrl: 'https://multicanaishd.lol/'
        }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowsFullscreenVideo={true}
        mediaPlaybackRequiresUserAction={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        supportMultipleWindows={true}
        onShouldStartLoadWithRequest={(request) => {
          const { url } = request;
          if (url === 'about:blank' || url.includes('multicanaishd.lol') || url.includes(resolvedUrl)) {
            return true;
          }
          
          console.log('[WebViewPlayer] Launching external ad URL in default browser:', url);
          Linking.openURL(url).catch((e) => console.warn('[WebViewPlayer] Error launching ad URL:', e));
          return false;
        }}
        onLoadStart={() => setIsLoading(true)}
        onLoadProgress={({ nativeEvent }) => {
          if (nativeEvent.progress > 0.65) {
            setIsLoading(false);
          }
        }}
        onLoadEnd={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setFetchError('Erro ao carregar o reprodutor web. Tente outro servidor.');
        }}
      />

      {/* Floating Glassmorphic Header overlaying the WebView */}
      {webViewHeaderVisible ? (
        <View style={styles.webViewHeaderContainer} pointerEvents="box-none">
          <LinearGradient
            colors={['rgba(5, 5, 5, 0.95)', 'rgba(5, 5, 5, 0.7)', 'transparent']}
            style={styles.webViewHeaderGradient}
            pointerEvents="box-none"
          >
            <View style={styles.webViewTopRow} pointerEvents="box-none">
              <View style={styles.webViewLeftInfo} pointerEvents="box-none">
                <TouchableOpacity 
                  style={styles.backButtonInline} 
                  onPress={handleGoBack}
                  activeOpacity={0.7}
                >
                  <Text style={styles.backButtonText}>‹</Text>
                </TouchableOpacity>
                
                <View style={styles.titleContainer}>
                  <Text style={styles.mediaTitle} numberOfLines={1}>{title}</Text>
                  <View style={styles.mediaCategoryRow}>
                    <Text style={styles.mediaCategory}>{category}</Text>
                    <View style={styles.badgeContainer}>
                      <Text style={styles.badgeText}>Full HD</Text>
                    </View>
                    <View style={styles.badgeContainer}>
                      <Text style={styles.badgeText}>5.1</Text>
                    </View>
                    <View style={[styles.badgeContainer, { borderColor: '#FF5555' }]}>
                      <Text style={[styles.badgeText, { color: '#FF5555' }]}>WEB</Text>
                    </View>
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {id && (
                  <TouchableOpacity 
                    style={styles.sourcesHeaderButton}
                    onPress={onOpenSources}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.sourcesHeaderButtonText}>🌐 Fontes</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity 
                  style={styles.hideHeaderBtn}
                  onPress={() => setWebViewHeaderVisible(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.hideHeaderBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          </LinearGradient>
        </View>
      ) : (
        id ? (
          <TouchableOpacity 
            style={styles.floatingExpandBtn}
            onPress={onOpenSources}
            activeOpacity={0.75}
          >
            <Text style={styles.floatingExpandBtnText}>🌐 Fontes</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity 
            style={styles.floatingExpandBtn}
            onPress={() => setWebViewHeaderVisible(true)}
            activeOpacity={0.75}
          >
            <Text style={styles.floatingExpandBtnText}>👁️ Controles</Text>
          </TouchableOpacity>
        )
      )}

      {!webViewHeaderVisible && (
        <TouchableOpacity 
          style={[
            styles.backButton,
            isLandscape && styles.backButtonLandscape
          ]} 
          onPress={handleGoBack}
          activeOpacity={0.7}
        >
          <Text style={styles.backButtonText}>‹</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};
