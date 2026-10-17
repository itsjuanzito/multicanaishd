import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';

export interface UserProfile {
  id: string;
  email: string;
  is_vip: boolean;
  vip_until: string | null;
  username: string | null;
  avatar: string | null;
}

export function useAuthStore() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Timeout de segurança: se o Supabase não responder (rede instável, túnel do
    // Expo Go lento, etc.), libera a UI como visitante em vez de travar no loading.
    const timeoutId = setTimeout(() => {
      setLoading(false);
    }, 6000);

    // Escuta mudanças de autenticação no Supabase
    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(timeoutId);
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id, session.user.email || '');
      } else {
        setLoading(false);
      }
    }).catch((err) => {
      clearTimeout(timeoutId);
      console.warn('[Auth] Falha ao recuperar sessão:', err);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id, session.user.email || '');
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  const fetchProfile = async (userId: string, email: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (data) {
        const isVIP = data.is_vip === true && (!data.vip_until || new Date(data.vip_until) > new Date());

        // A derivação de plano que existia aqui (valor pago -> diamond/mensal/...) foi
        // removida: nada no app consumia `vip_plan`, e ela era a terceira cópia da tabela
        // de preços. Quem decide acesso a fonte premium é o servidor, no get-source, a
        // partir do Bearer que o PlayerScreen manda — o app não precisa saber o plano.
        setProfile({
          id: data.id,
          email: data.email || email,
          is_vip: isVIP,
          vip_until: data.vip_until,
          username: data.username,
          avatar: data.avatar,
        });
      }
    } catch (err) {
      console.error("Erro ao buscar perfil do Supabase no Mobile:", err);
    } finally {
      setLoading(false);
    }
  };

  return {
    session,
    profile,
    loading,
    isAuthenticated: !!session?.user,
    isVIP: !!profile?.is_vip,
  };
}
