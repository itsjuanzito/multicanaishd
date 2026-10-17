import { StyleSheet, Platform } from 'react-native';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#050505',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 16,
  },

  // CABEÇALHO TRANSPARENTE FLUTUANTE (OVERLAY LOCAL - Pilar 1 & 7)
  brandHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: Platform.OS === 'android' ? 95 : 105,
    paddingTop: Platform.OS === 'android' ? 38 : 48,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 100, // Fica sobreposto à lista do HomeScreen
  },
  hamburgerButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingLeft: 4,
    zIndex: 101,
  },
  hamburgerLine: {
    height: 2.5,
    width: 22,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
    marginVertical: 2,
  },
  logoContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: Platform.OS === 'android' ? 38 : 48,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: -1, // Garante que cliques no botão hambúrguer ao lado funcionem
  },
  logoText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -1,
  },
  logoRed: {
    color: '#FF5555',
  },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchHeaderButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 101,
  },
  searchIconText: {
    fontSize: 18,
    color: '#FFFFFF',
  },
});
