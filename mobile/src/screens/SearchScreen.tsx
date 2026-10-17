import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  Keyboard
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { 
  searchMedia, 
  getTrendingMedia, 
  TMDBMedia 
} from '../services/tmdbService';
import { styles } from './SearchScreen.styles';

export default function SearchScreen() {
  const navigation = useNavigation<any>();
  
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TMDBMedia[]>([]);
  const [recommendations, setRecommendations] = useState<TMDBMedia[]>([]);
  const [loading, setLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load initial trending recommendations
  useEffect(() => {
    let isMounted = true;
    async function loadSuggestions() {
      try {
        const trending = await getTrendingMedia();
        if (isMounted) {
          setRecommendations(trending.slice(0, 15)); // Get top 15 trending titles
        }
      } catch (error) {
        console.warn('⚠️ [SearchScreen] Falha ao carregar recomendações:', error);
      }
    }
    loadSuggestions();
    return () => {
      isMounted = false;
    };
  }, []);

  // Live search handler with Debounce (400ms)
  const performSearch = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setResults([]);
      setHasSearched(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await searchMedia(trimmed);
      setResults(data);
      setHasSearched(true);
    } catch (error) {
      console.error('⚠️ [SearchScreen] Erro ao realizar busca:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      performSearch(query);
    }, 400);

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [query, performSearch]);

  const handleClear = useCallback(() => {
    setQuery('');
    setResults([]);
    setHasSearched(false);
    setLoading(false);
  }, []);

  const handleMediaPress = useCallback((media: TMDBMedia) => {
    Keyboard.dismiss();
    navigation.navigate('Details', { media });
  }, [navigation]);

  const renderMediaCard = useCallback(({ item }: { item: TMDBMedia }) => {
    const posterUrl = item.poster || 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&q=80';
    
    return (
      <TouchableOpacity
        style={styles.mediaCard}
        onPress={() => handleMediaPress(item)}
        activeOpacity={0.8}
      >
        <Image
          source={{ uri: posterUrl }}
          style={styles.posterImage}
          resizeMode="cover"
        />
        
        {/* Cinematic bottom shadow gradient */}
        <LinearGradient
          colors={['transparent', 'rgba(0, 0, 0, 0.85)', '#050505']}
          style={styles.cardGradient}
        />

        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <View style={styles.cardMetaRow}>
            <Text style={styles.cardYear}>{item.year}</Text>
            {item.rating && (
              <View style={styles.ratingBadge}>
                <Text style={styles.ratingStar}>⭐</Text>
                <Text style={styles.ratingText}>{item.rating}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [handleMediaPress]);

  // Decides whether to show results or initial trending recommendations
  const activeData = query.trim() !== '' ? results : recommendations;

  return (
    <View style={styles.container}>
      {/* Header Container */}
      <View style={styles.header}>
        {/* Back Button */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Feather name="chevron-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>

        {/* Search Input Box */}
        <View
          style={[
            styles.searchInputWrapper,
            isFocused && styles.searchInputWrapperActive
          ]}
        >
          <Feather name="search" size={16} color="rgba(255, 255, 255, 0.4)" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Pesquisar filmes ou séries..."
            placeholderTextColor="rgba(255, 255, 255, 0.35)"
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            autoFocus={true}
            autoCorrect={false}
            returnKeyType="search"
            keyboardAppearance="dark"
          />
          {query.length > 0 && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={handleClear}
              activeOpacity={0.7}
            >
              <Feather name="x" size={16} color="#FF5555" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Suggestion Section Title */}
      {!loading && query.trim() === '' && recommendations.length > 0 && (
        <Text style={styles.sectionTitle}>
          Títulos Recomendados
        </Text>
      )}

      {/* Main Grid View */}
      {loading ? (
        <ActivityIndicator
          size="large"
          color="#FF5555"
          style={styles.loadingIndicator}
        />
      ) : activeData.length === 0 ? (
        <View style={styles.emptyStateContainer}>
          <Feather name="search" size={48} color="rgba(255, 255, 255, 0.2)" style={{ marginBottom: 16 }} />
          <Text style={styles.emptyStateTitle}>
            {hasSearched
              ? 'Nenhum resultado encontrado'
              : 'Digite algo para buscar'}
          </Text>
          <Text style={styles.emptyStateText}>
            {hasSearched
              ? 'Tente verificar a grafia ou procure por outro filme/série.'
              : 'Explore nosso catálogo premium digitando o título que deseja assistir.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={activeData}
          keyExtractor={(item) => `search-${item.id}-${item.title}`}
          renderItem={renderMediaCard}
          numColumns={3}
          contentContainerStyle={styles.gridContainer}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}
