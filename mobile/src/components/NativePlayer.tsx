import React from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  ActivityIndicator, 
  TouchableWithoutFeedback,
  ScrollView,
  StyleSheet
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { styles } from '../screens/PlayerScreen.styles';

interface NativePlayerProps {
  videoRef: React.RefObject<Video | null>;
  resolvedUrl: string;
  streamHeaders: any;
  isPlaying: boolean;
  handlePlaybackStatusUpdate: (status: any) => void;
  isLoading: boolean;
  handleScreenTap: () => void;
  controlsVisible: boolean;
  isLandscape: boolean;
  handleGoBack: () => void;
  title: string;
  category: string;
  id?: string;
  onOpenSources: () => void;
  handleSkipBackward: () => void;
  handleSkipForward: () => void;
  handleTogglePlay: () => void;
  setProgressBarWidth: (width: number) => void;
  handleProgressBarPress: (event: any) => void;
  progressPercent: number;
  position: number;
  duration: number;
  formatTime: (millis: number) => string;
}

export const NativePlayer: React.FC<NativePlayerProps> = ({
  videoRef,
  resolvedUrl,
  streamHeaders,
  isPlaying,
  handlePlaybackStatusUpdate,
  isLoading,
  handleScreenTap,
  controlsVisible,
  isLandscape,
  handleGoBack,
  title,
  category,
  id,
  onOpenSources,
  handleSkipBackward,
  handleSkipForward,
  handleTogglePlay,
  setProgressBarWidth,
  handleProgressBarPress,
  progressPercent,
  position,
  duration,
  formatTime,
}) => {
  return (
    <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#000' }}>
      <Video
        ref={videoRef}
        source={{ 
          uri: resolvedUrl,
          headers: streamHeaders
        }}
        style={styles.video}
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay={isPlaying}
        onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
        useNativeControls={false}
      />

      {isLoading && (
        <View style={[styles.loadingOverlay, { backgroundColor: 'transparent' }]}>
          <ActivityIndicator size="large" color="#FF5555" />
        </View>
      )}

      {/* Touch overlay to toggle controls visibility */}
      <TouchableWithoutFeedback onPress={handleScreenTap}>
        <View style={[StyleSheet.absoluteFillObject, { zIndex: 8 }]} />
      </TouchableWithoutFeedback>

      {/* Custom Controls Overlay */}
      {controlsVisible && (
        <View 
          style={[
            styles.controlsOverlay, 
            isLandscape && styles.controlsOverlayLandscape
          ]} 
          pointerEvents="box-none"
        >
          {/* Cinematic Top Vignette Shadow */}
          <LinearGradient
            colors={['rgba(5, 5, 5, 0.95)', 'rgba(5, 5, 5, 0.7)', 'rgba(5, 5, 5, 0.1)', 'transparent']}
            style={styles.topGradient}
            pointerEvents="none"
          />

          {/* Cinematic Bottom Vignette Shadow */}
          <LinearGradient
            colors={['transparent', 'rgba(5, 5, 5, 0.1)', 'rgba(5, 5, 5, 0.7)', 'rgba(5, 5, 5, 0.95)']}
            style={styles.bottomGradient}
            pointerEvents="none"
          />

          {/* Top Title Section */}
          <View style={[styles.topControls, isLandscape && styles.topControlsLandscape]} pointerEvents="box-none">
            <View style={styles.topLeftControls} pointerEvents="box-none">
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
                    <Text style={[styles.badgeText, { color: '#FF5555' }]}>NATIVO</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Premium sources button in top-right corner */}
            {id && (
              <TouchableOpacity 
                style={styles.sourcesHeaderButton}
                onPress={onOpenSources}
                activeOpacity={0.75}
              >
                <Text style={styles.sourcesHeaderButtonText}>🌐 Fontes</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Middle Playback Controls (10s Skip & Play/Pause) */}
          <View style={[styles.middleControlsRow, isLandscape && styles.middleControlsRowLandscape]}>
            {/* 10s Rewind */}
            <TouchableOpacity 
              style={styles.skipBtn}
              onPress={handleSkipBackward}
              activeOpacity={0.7}
            >
              <Text style={styles.skipBtnIcon}>↺</Text>
              <Text style={styles.skipBtnText}>10</Text>
            </TouchableOpacity>

            {/* Center Play/Pause button */}
            <TouchableOpacity 
              style={[
                styles.playPauseBtn,
                isLandscape && { width: 56, height: 56, borderRadius: 28 }
              ]}
              onPress={handleTogglePlay}
              activeOpacity={0.85}
            >
              <Text style={[
                styles.playPauseIconText,
                !isPlaying && { marginLeft: 4 }, // Apply visual offset only when paused (showing play triangle)
                isLandscape && { fontSize: 18, marginLeft: !isPlaying ? 3 : 0 }
              ]}>
                {isPlaying ? '⏸' : '▶'}
              </Text>
            </TouchableOpacity>

            {/* 10s Skip Forward */}
            <TouchableOpacity 
              style={styles.skipBtn}
              onPress={handleSkipForward}
              activeOpacity={0.7}
            >
              <Text style={styles.skipBtnIcon}>↻</Text>
              <Text style={styles.skipBtnText}>10</Text>
            </TouchableOpacity>
          </View>

          {/* Bottom Timeline Section (Interactive) */}
          <View style={[styles.bottomControls, isLandscape && styles.bottomControlsLandscape]}>
            <View 
              style={styles.progressBarContainer}
              onLayout={(e) => setProgressBarWidth(e.nativeEvent.layout.width)}
              onTouchStart={handleProgressBarPress}
            >
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarActive, { width: `${progressPercent}%` }]} />
                <View style={[styles.progressBarThumb, { left: `${progressPercent}%`, marginLeft: -6 }]} />
              </View>
            </View>

            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatTime(position)}</Text>
              <Text style={styles.timeText}>{formatTime(duration)}</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
};
