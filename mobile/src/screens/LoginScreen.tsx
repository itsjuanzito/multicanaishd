// mobile/src/screens/LoginScreen.tsx
import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Keyboard
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { Feather, FontAwesome } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { styles } from './LoginScreen.styles';

WebBrowser.maybeCompleteAuthSession();

const NICKNAME_CHECK_URL = 'https://multicanaishd.lol/api/auth/check-nickname';

interface LoginScreenProps {
  onAuthenticated: () => void;
  onContinueAsGuest: () => void;
}

const BENEFITS = [
  { icon: 'tv' as const, title: 'Canais & Jogos', desc: 'TV ao vivo e transmissões esportivas na hora.' },
  { icon: 'play-circle' as const, title: 'Continuar assistindo', desc: 'Retome de onde parou em qualquer episódio.' },
  { icon: 'list' as const, title: 'Minha Lista', desc: 'Salve títulos favoritos para assistir depois.' },
  { icon: 'star' as const, title: 'Seja VIP', desc: 'Catálogo completo, sem anúncios e recursos exclusivos.' },
];

function LoginScreen({ onAuthenticated, onContinueAsGuest }: LoginScreenProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [nickname, setNickname] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const passwordInputRef = useRef<TextInput>(null);
  const displayNameInputRef = useRef<TextInput>(null);
  const nicknameInputRef = useRef<TextInput>(null);

  const handleGoogleLogin = useCallback(async () => {
    setErrorMessage('');
    setGoogleLoading(true);
    try {
      // Sem "scheme" fixo: no Expo Go isso gera uma URI exp://, em build nativo usa
      // o scheme "multicanaishd" do app.json — cada ambiente precisa estar cadastrado
      // em Supabase > Authentication > URL Configuration > Redirect URLs.
      const redirectTo = AuthSession.makeRedirectUri({ path: 'login' });
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('Não foi possível iniciar o login com Google.');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success' || !result.url) return;

      const resultUrl = new URL(result.url.replace('#', '?'));
      const params = resultUrl.searchParams;
      const errorCode = params.get('error_code') || params.get('error');
      if (errorCode) throw new Error(errorCode);

      const code = params.get('code');
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) throw exchangeError;
      } else if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) throw sessionError;
      } else {
        throw new Error('Resposta inválida do Google.');
      }

      onAuthenticated();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Não foi possível entrar com Google. Tente novamente.');
    } finally {
      setGoogleLoading(false);
    }
  }, [onAuthenticated]);

  const handleSubmit = useCallback(async () => {
    // Fecha o teclado ANTES de esperar a rede — evita o teclado ficar "preso"
    // aberto (junto com a barra preta do edge-to-edge no Android) enquanto navega.
    Keyboard.dismiss();
    setErrorMessage('');

    if (!email.trim()) {
      setErrorMessage('Digite seu e-mail.');
      return;
    }
    if (!password) {
      setErrorMessage('Digite sua senha.');
      return;
    }

    const trimmedDisplayName = displayName.trim();
    const trimmedNickname = nickname.trim().toLowerCase();

    if (isSignUp) {
      if (!trimmedDisplayName || trimmedDisplayName.length < 2) {
        setErrorMessage('Nome de exibição é obrigatório (mín. 2 caracteres).');
        return;
      }
      if (!trimmedNickname || trimmedNickname.length < 3 || !/^[a-z0-9_]+$/.test(trimmedNickname)) {
        setErrorMessage('@username é obrigatório (mín. 3 caracteres, apenas a-z, 0-9, _).');
        return;
      }
    }

    setLoading(true);
    try {
      if (isSignUp) {
        try {
          const checkRes = await fetch(`${NICKNAME_CHECK_URL}?nickname=${encodeURIComponent(trimmedNickname)}`);
          const checkData = await checkRes.json();
          if (!checkData.available) {
            setErrorMessage('Este @username já está em uso. Escolha outro.');
            return;
          }
        } catch {
          setErrorMessage('Não foi possível validar o @username. Tente novamente.');
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              display_name: trimmedDisplayName,
              nickname: trimmedNickname,
            },
          },
        });
        if (error) {
          setErrorMessage(error.message);
          return;
        }

        if (data?.user) {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            username: trimmedDisplayName,
            watched_episodes: {
              _nickname: trimmedNickname,
              _nickname_changes_count: '0',
              _vip_nickname_changes_count: '0',
            },
          }, { onConflict: 'id' });
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) {
          setErrorMessage(error.message);
          return;
        }
      }

      onAuthenticated();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Não foi possível conectar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [email, password, displayName, nickname, isSignUp, onAuthenticated]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoWrap}>
          <Text style={styles.logoText}>
            MULTI<Text style={styles.logoRed}>FLIX</Text>
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>{isSignUp ? 'Criar conta' : 'Entrar'}</Text>

          <View style={[styles.fieldGroup, styles.firstFieldGroup]}>
            <Text style={styles.fieldLabel}>E-mail</Text>
            <TextInput
              style={styles.input}
              placeholder="seu@email.com"
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="next"
              onSubmitEditing={() => (isSignUp ? displayNameInputRef.current?.focus() : passwordInputRef.current?.focus())}
              blurOnSubmit={false}
              value={email}
              onChangeText={setEmail}
            />
          </View>

          {isSignUp && (
            <>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Nome de exibição</Text>
                <TextInput
                  ref={displayNameInputRef}
                  style={styles.input}
                  placeholder="Como você quer ser chamado"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  maxLength={25}
                  returnKeyType="next"
                  onSubmitEditing={() => nicknameInputRef.current?.focus()}
                  blurOnSubmit={false}
                  value={displayName}
                  onChangeText={setDisplayName}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Seu @username (único)</Text>
                <TextInput
                  ref={nicknameInputRef}
                  style={styles.input}
                  placeholder="seunick"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                  blurOnSubmit={false}
                  value={nickname}
                  onChangeText={(text) => setNickname(text.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                />
              </View>
            </>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Senha</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                ref={passwordInputRef}
                style={styles.passwordInput}
                placeholder="••••••••"
                placeholderTextColor="rgba(255,255,255,0.3)"
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity
                style={styles.passwordToggle}
                onPress={() => setShowPassword(prev => !prev)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color="rgba(255,255,255,0.4)" />
              </TouchableOpacity>
            </View>
          </View>

          {errorMessage ? (
            <Text style={styles.errorText}>
              {errorMessage}
            </Text>
          ) : null}

          <TouchableOpacity
            style={styles.submitButton}
            onPress={handleSubmit}
            disabled={loading || googleLoading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.submitButtonText}>
                {isSignUp ? 'Criar conta' : 'Entrar'}
              </Text>
            )}
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou continue com</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={styles.googleButton}
            onPress={handleGoogleLogin}
            disabled={loading || googleLoading}
            activeOpacity={0.85}
          >
            {googleLoading ? (
              <ActivityIndicator color="#000000" />
            ) : (
              <>
                <FontAwesome name="google" size={18} color="#000000" />
                <Text style={styles.googleButtonText}>Entrar com Google</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.toggleModeButton}
            onPress={() => {
              setErrorMessage('');
              setIsSignUp(prev => !prev);
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.toggleModeText}>
              {isSignUp ? 'Já tem conta? ' : 'Não tem conta? '}
              <Text style={styles.toggleModeHighlight}>
                {isSignUp ? 'Entrar' : 'Criar conta'}
              </Text>
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.benefitsCard}>
          <Text style={styles.benefitsTitle}>Vantagens de fazer login</Text>
          {BENEFITS.map((benefit) => (
            <View key={benefit.title} style={styles.benefitRow}>
              <View style={styles.benefitIconWrap}>
                <Feather name={benefit.icon} size={16} color="#FF5555" />
              </View>
              <View style={styles.benefitTextWrap}>
                <Text style={styles.benefitTitle}>{benefit.title}</Text>
                <Text style={styles.benefitDesc}>{benefit.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.guestButton}
          onPress={() => {
            Keyboard.dismiss();
            onContinueAsGuest();
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.guestButtonText}>Continuar como visitante</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default LoginScreen;
