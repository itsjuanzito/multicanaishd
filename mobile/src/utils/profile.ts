// Domínio canônico atual. Estava em `multicanaishd.lol`, que hoje só responde 301 — os avatares
// até carregavam porque o redirect é seguido, mas cada requisição pagava um salto extra (e um
// POST nessa URL quebraria em silêncio, como já aconteceu com o webhook do LivePix).
const SITE_URL = 'https://multicanaishd.lol';

export function getAvatarUrl(avatar: string | null | undefined): string | null {
  if (!avatar) return null;
  if (avatar.startsWith('http://') || avatar.startsWith('https://')) return avatar;
  const id = parseInt(avatar, 10);
  if (!id) return null;
  return id > 5 ? `${SITE_URL}/avatars/avatar_${id}.png` : `${SITE_URL}/avatars/avatar_${id}.svg`;
}

export function formatVipPlan(plan: string | null | undefined): string {
  if (!plan) return 'VIP Ativo';
  const clean = String(plan).toLowerCase().trim();
  if (clean === 'mensal') return 'VIP Mensal';
  if (clean === 'trimestral') return 'VIP Trimestral';
  if (clean === 'anual') return 'VIP Anual';
  if (clean === 'vitalicio') return 'VIP Vitalício';
  if (clean === 'diamond_mensal') return 'VIP Diamond Mensal';
  if (clean === 'diamond_trimestral') return 'VIP Diamond Trimestral';
  if (clean === 'diamond_anual') return 'VIP Diamond Anual';
  return clean
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
