import { StyleSheet, Dimensions, Platform } from 'react-native';

const { width, height } = Dimensions.get('window');

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  
  // NATIVE VIDEO COMPONENT
  video: {
    width: '100%',
    height: '100%',
  },
  
  // WEBVIEW FOR EMBEDS
  webview: {
    flex: 1,
    backgroundColor: '#000000',
  },
  
  // LOADING COVER
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9,
  },
  loadingText: {
    color: '#FF5555',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 14,
    textTransform: 'uppercase',
  },

  // UNIFIED FLOATING BACK BUTTON
  backButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 34,
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: -2,
  },
  
  // CUSTOM CONTROLS OVERLAY (Pilar 1)
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent', // Transparent background since we use top and bottom vignettes!
    justifyContent: 'space-between',
    padding: 24,
    zIndex: 10,
  },
  
  // CINEMATIC FADES
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 160,
    zIndex: -1,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 160,
    zIndex: -1,
  },
  
  // WEBVIEW HEADER CONTROLS (Pilar 1 & Glassmorphism)
  webViewHeaderContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 99,
  },
  webViewHeaderGradient: {
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 44 : 20,
    paddingBottom: 24,
  },
  webViewTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  webViewLeftInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    maxWidth: '85%',
  },
  webViewServerSelector: {
    marginTop: 12,
    paddingLeft: 46,
    height: 40,
  },
  hideHeaderBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hideHeaderBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
  floatingExpandBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 34,
    right: 20,
    backgroundColor: 'rgba(5, 5, 5, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    zIndex: 99,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 5,
  },
  floatingExpandBtnText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  // TOP INFO ROW
  topControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Platform.OS === 'ios' ? 24 : 10,
    paddingLeft: 46, // Space for floating back button
  },
  titleContainer: {
    flex: 1,
  },
  mediaTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  mediaCategory: {
    color: '#FF5555',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 2,
  },
  mediaCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  badgeContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
  badgeText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  
  // SERVER SELECTION SCROLL BAR (Pilar 1 Glassmorphism)
  serverSelectionContainer: {
    marginTop: 12,
    paddingLeft: 46, // Align with title
    height: 40,
  },
  serverScroll: {
    gap: 8,
    paddingRight: 20,
    alignItems: 'center',
  },
  serverPill: {
    backgroundColor: 'rgba(15, 15, 15, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  serverPillActive: {
    backgroundColor: '#FF5555',
    borderColor: '#FF5555',
    shadowColor: '#FF5555',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 4,
  },
  serverPillText: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 11,
    fontWeight: '700',
  },
  serverPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  
  // MIDDLE CONTROLS ROW (Pilar 1 Layout)
  middleControlsRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 36,
  },
  middleControlsRowLandscape: {
    gap: 28,
  },
  
  // SKIP BUTTONS (Netflix-style)
  skipBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  skipBtnIcon: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  skipBtnText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 8,
    fontWeight: '900',
    marginTop: -4,
    textAlign: 'center',
  },

  playPauseBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FF5555',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FF5555',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  playPauseIconText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: 'bold',
    marginLeft: 3, // Visual offset for play icon centering
  },
  
  // BOTTOM CONTROLS (SEEK BAR - High Fidelity)
  bottomControls: {
    marginBottom: Platform.OS === 'ios' ? 20 : 8,
    paddingHorizontal: 8,
  },
  progressBarContainer: {
    width: '100%',
    height: 24, // High-accessibility tap target!
    justifyContent: 'center',
    marginBottom: 8,
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 2,
    position: 'relative',
  },
  progressBarActive: {
    height: '100%',
    backgroundColor: '#FF5555',
    borderRadius: 2,
  },
  progressBarThumb: {
    position: 'absolute',
    top: -5, // Center in a 4px track: height 14 -> top is (4 - 14)/2 = -5!
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
    borderWidth: 2.5,
    borderColor: '#FF5555',
    shadowColor: '#FF5555',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
    elevation: 4,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timeText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
 
  // HIGH FIDELITY ERROR VIEWS (Pilar 2)
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
    backgroundColor: '#050505',
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginBottom: 8,
    textAlign: 'center',
  },
  errorText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 32,
  },
  errorServersContainer: {
    width: '100%',
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  errorServersLabel: {
    color: '#FF5555',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  errorServersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
 
  // RESPONSIVE LANDSCAPE & INLINE CLASSES
  backButtonLandscape: {
    top: 20,
    left: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  backButtonInline: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  topLeftControls: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    maxWidth: '55%',
  },
  controlsOverlayLandscape: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  topControlsLandscape: {
    marginTop: Platform.OS === 'ios' ? 10 : 0,
    paddingLeft: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
  },
  sourcesHeaderButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sourcesHeaderButtonText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sourcesBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    zIndex: 1000,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  sourcesDrawerContainer: {
    width: 300,
    height: '100%',
    backgroundColor: '#050505',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 24 : 12,
    paddingBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: -8, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 20,
  },
  drawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 12,
  },
  sourcesDrawerTitle: {
    color: '#FF5555',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  closeDrawerBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeDrawerBtnText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
  },
  drawerScrollViewContent: {
    paddingBottom: 24,
  },
  drawerSubtitle: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 10,
    lineHeight: 14,
    marginBottom: 16,
  },
  drawerServerPill: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  drawerServerPillActive: {
    backgroundColor: 'rgba(255, 85, 85, 0.08)',
    borderColor: '#FF5555',
    shadowColor: '#FF5555',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  drawerServerInfo: {
    flex: 1,
    gap: 4,
  },
  drawerServerName: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    fontWeight: '700',
  },
  drawerServerNameActive: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  drawerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  drawerBadge: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  drawerBadgeNative: {
    backgroundColor: 'rgba(255, 85, 85, 0.1)',
    borderColor: 'rgba(255, 85, 85, 0.25)',
  },
  drawerBadgeWeb: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  drawerBadgeText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 7,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  drawerActiveBadge: {
    backgroundColor: '#FF5555',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  drawerActiveBadgeText: {
    color: '#FFFFFF',
    fontSize: 6,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  drawerArrow: {
    color: 'rgba(255, 255, 255, 0.3)',
    fontSize: 14,
    fontWeight: '900',
    paddingLeft: 8,
  },
  middleControlsLandscape: {
    marginVertical: 2,
  },
  bottomControlsLandscape: {
    marginBottom: Platform.OS === 'ios' ? 8 : 2,
  },
});
