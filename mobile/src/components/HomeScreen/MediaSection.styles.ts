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

  // MOVIES CARD GRID
  moviesList: {
    gap: 14,
    paddingRight: 20,
  },
  movieCard: {
    width: 135,
    position: 'relative',
    marginRight: 4,
  },
  movieImage: {
    width: 135,
    height: 190,
    borderRadius: 18,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  movieBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(5, 5, 5, 0.82)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  movieBadgeText: {
    color: '#FFEC3D',
    fontSize: 9,
    fontWeight: '900',
  },
  movieTitle: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 8,
  },
  movieCategory: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 9,
    fontWeight: '600',
    marginTop: 3,
  },
});
