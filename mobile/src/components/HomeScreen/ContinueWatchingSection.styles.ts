import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  section: {
    marginTop: 28,
    marginBottom: 6,
    paddingHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitleIndicator: {
    width: 3.5,
    height: 18,
    backgroundColor: '#FF5555',
    borderRadius: 2,
    marginRight: 8,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.3,
    textTransform: 'uppercase',
  },
  list: {
    gap: 14,
    paddingRight: 20,
  },
  card: {
    width: 220,
    marginRight: 4,
  },
  cardImage: {
    width: 220,
    height: 124,
    borderRadius: 16,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FF5555',
    borderRadius: 2,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 8,
  },
  cardWatchedText: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 3,
  },
});
