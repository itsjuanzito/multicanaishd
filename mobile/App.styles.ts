import { StyleSheet, Dimensions, Platform } from 'react-native';

const { width } = Dimensions.get('window');

export const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: '#050505',
  },
  contentContainer: {
    flex: 1,
    backgroundColor: '#050505',
  },
  
  // CABEÇALHO TRANSPARENTE FLUTUANTE OVERLAY
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
  symmetryPlaceholder: {
    width: 40,
    height: 40,
  },
  
  // MENU LATERAL DRAWER STYLES
  drawerRoot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
  },
  drawerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  drawerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: width * 0.78,
    maxWidth: 300,
    backgroundColor: '#141414',
    borderRightWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    padding: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 24,
  },
  drawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    marginTop: Platform.OS === 'ios' ? 12 : 6,
  },
  drawerLogoText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -1,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#8A8A8A',
    fontSize: 14,
    fontWeight: 'bold',
  },
  drawerScroll: {
    flex: 1,
  },
  
  // CARD DE PERFIL (Pilar 1)
  drawerProfileCard: {
    backgroundColor: '#1c1c1c',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    marginBottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileAvatarContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FF5555',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  profileAvatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  profileVipBadge: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    backgroundColor: '#141414',
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  profileVipBadgeText: {
    fontSize: 9,
  },
  profileInfoContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  profileName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  profileStatusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  profileStatusStandard: {
    color: 'rgba(255, 255, 255, 0.4)',
  },
  profileStatusVip: {
    color: '#FF5555',
  },
  
  drawerSectionTitle: {
    color: 'rgba(255, 255, 255, 0.3)',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 4,
  },
  drawerItemActive: {
    backgroundColor: 'rgba(255, 85, 85, 0.08)',
  },
  drawerItemText: {
    color: '#8A8A8A',
    fontSize: 14,
    fontWeight: '700',
  },
  drawerItemTextActive: {
    color: '#FF5555',
    fontWeight: '800',
  },
  drawerSeparator: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    marginVertical: 18,
  },
  drawerLogoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  drawerLogoutText: {
    color: '#FF5555',
    fontSize: 14,
    fontWeight: '700',
  },

  // SUBMENU "EXPLORAR"
  drawerChevron: {
    marginLeft: 'auto',
  },
  drawerSubItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 28,
    paddingRight: 12,
    borderRadius: 14,
    marginBottom: 2,
  },

  // AÇÕES RÁPIDAS (idioma / discord / telegram)
  drawerQuickActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  drawerQuickActionBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#1c1c1c',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  drawerQuickActionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
});
