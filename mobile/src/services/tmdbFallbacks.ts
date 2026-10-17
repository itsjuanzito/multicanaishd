import { TMDBMedia } from './tmdbService';

export const FALLBACK_HEROES: TMDBMedia[] = [
  {
    id: '693134',
    title: 'Duna: Parte Dois',
    category: 'Ficção Científica / Aventura',
    rating: '8.8',
    banner: 'https://image.tmdb.org/t/p/w780/xOMXRj7vXFw56oKStJ96kr4zT4C.jpg',
    poster: 'https://image.tmdb.org/t/p/w500/czembWD5dBD452g5uC4UKe5g4uN.jpg',
    overview: 'Paul Atreides se une a Chani e aos Fremen enquanto busca vingança contra os conspiradores que destruíram sua família. Enfrentando uma escolha entre o amor de sua vida e o destino do universo, ele se esforça para evitar um futuro terrível que só ele pode prever.',
    year: '2024'
  },
  {
    id: '569094',
    title: 'Homem-Aranha: Através do Aranhaverso',
    category: 'Animação / Ação',
    rating: '8.7',
    banner: 'https://image.tmdb.org/t/p/w780/w7rl744hLOjzg6NyHmbp7tgr4t6.jpg',
    poster: 'https://image.tmdb.org/t/p/w500/8Vtbi7Su4o7y5UGt5XT6vhqZ4DM.jpg',
    overview: 'Depois de se reunir com Gwen Stacy, o Homem-Aranha amigável do Brooklyn é catapultado através do Multiverso, onde ele encontra uma equipe de Pessoas-Aranha encarregadas de proteger sua própria existência.',
    year: '2023'
  }
];

export const FALLBACK_MOVIES: TMDBMedia[] = [
  { id: '414906', title: 'The Batman', category: 'Ação / Policial', rating: '8.1', banner: '', poster: 'https://image.tmdb.org/t/p/w500/74xTEgt7R361n5N6su5Jj9Q732I.jpg', overview: 'Batman explora a corrupção em Gotham City enquanto persegue o Charada, um assassino em série que tem como alvo a elite de Gotham.', year: '2022' },
  { id: '76600', title: 'Avatar: O Caminho da Água', category: 'Ficção Científica', rating: '7.6', banner: '', poster: 'https://image.tmdb.org/t/p/w500/t6HI23TTV5wzSR80j53iFBb1cd7.jpg', overview: 'Jake Sully e Neytiri formaram uma família e estão fazendo de tudo para ficarem juntos. No entanto, eles devem sair de casa e explorar as regiões de Pandora.', year: '2022' },
  { id: '872585', title: 'Oppenheimer', category: 'Drama / História', rating: '8.5', banner: '', poster: 'https://image.tmdb.org/t/p/w500/8Gxv2wSsuR0e0K2GI9H3mZ8RjuY.jpg', overview: 'O papel do físico J. Robert Oppenheimer no desenvolvimento da bomba atômica durante a Segunda Guerra Mundial.', year: '2023' },
  { id: '1022789', title: 'Divertida Mente 2', category: 'Animação / Família', rating: '8.6', banner: '', poster: 'https://image.tmdb.org/t/p/w500/vpnVM9B6NMmFJpZxOFVnLTYO5Ka.jpg', overview: 'Com a adolescência, a mente de Riley sofre uma demolição repentina para dar espaço a novas emoções.', year: '2024' },
  { id: '533535', title: 'Deadpool & Wolverine', category: 'Ação / Comédia', rating: '8.0', banner: '', poster: 'https://image.tmdb.org/t/p/w500/8cdWjvZpa84YrV5Np9SIFF4t2WM.jpg', overview: 'Deadpool é recrutado pela AVT para salvar seu universo e une forças com um Wolverine relutante de outra linha temporal.', year: '2024' }
];

export const FALLBACK_SERIES: TMDBMedia[] = [
  { id: '100088', title: 'The Last of Us', category: 'Ação / Drama', rating: '8.6', banner: '', poster: 'https://image.tmdb.org/t/p/w500/uKVKSj6n58nZCu5e7hm4t1rjT5F.jpg', overview: 'Vinte anos após a destruição da civilização moderna, Joel é contratado para tirar Ellie de uma zona de quarentena opressiva.', year: '2023' },
  { id: '119051', title: 'Wandinha', category: 'Mistério / Comédia', rating: '8.5', banner: '', poster: 'https://image.tmdb.org/t/p/w500/a11F4xwiiBsZCrVvV4y5ohTYeju.jpg', overview: 'Inteligente, sarcástica e um pouco fria, Wandinha Addams investiga uma onda de assassinatos na Escola Nunca Mais.', year: '2022' },
  { id: '94997', title: 'A Casa do Dragão', category: 'Drama / Fantasia', rating: '8.4', banner: '', poster: 'https://image.tmdb.org/t/p/w500/1XS5jma4o2i4oRPj0nUxHIu1nS1.jpg', overview: 'A história da disputa interna da Casa Targaryen pelo Trono de Ferro, 200 anos antes dos eventos de Game of Thrones.', year: '2022' },
  { id: '76479', title: 'The Boys', category: 'Ação / Ficção Científica', rating: '8.5', banner: '', poster: 'https://image.tmdb.org/t/p/w500/7Ns4Bq4QpS46V410o29D4f9jJ8D.jpg', overview: 'Um grupo de vigilantes se propõe a derrubar super-heróis corruptos que abusam de seus superpoderes.', year: '2019' }
];

export const FALLBACK_ANIMES: TMDBMedia[] = [
  { id: '85244', title: 'Demon Slayer: Kimetsu no Yaiba', category: 'Anime / Ação', rating: '8.7', banner: '', poster: 'https://image.tmdb.org/t/p/w500/xBHvZ22ZjGx46547Zwkgab548C6.jpg', overview: 'Tanjiro Kamado se torna um caçador de demônios após sua família ser massacrada e sua irmã Nezuko ser transformada em demônio.', year: '2019' },
  { id: '1429', title: 'Shingeki no Kyojin (Attack on Titan)', category: 'Anime / Ação', rating: '8.9', banner: '', poster: 'https://image.tmdb.org/t/p/w500/8C5V07g26Q2V6B6g7N3g8b3mQ.jpg', overview: 'A humanidade luta por sua sobrevivência atrás de enormes muralhas contra Titãs devoradores de homens.', year: '2013' },
  { id: '95479', title: 'Jujutsu Kaisen', category: 'Anime / Ação', rating: '8.6', banner: '', poster: 'https://image.tmdb.org/t/p/w500/g16UpuiZ55W1r5F5w2N3g8b3mQ.jpg', overview: 'Yuji Itadori entra para uma escola de feiticeiros jujutsu para combater uma terrível maldição que reside dentro dele.', year: '2020' }
];

export const FALLBACK_DORAMAS: TMDBMedia[] = [
  { id: '94796', title: 'Pousando no Amor', category: 'Dorama / Romance', rating: '8.8', banner: '', poster: 'https://image.tmdb.org/t/p/w500/9kMug5dBD452g5uC4UKe5g4uN.jpg', overview: 'Uma herdeira sul-coreana cai acidentalmente na Coreia do Norte e é protegida por um oficial do exército norte-coreano.', year: '2019' },
  { id: '104294', title: 'Tudo Bem Não Ser Normal', category: 'Dorama / Drama', rating: '8.7', banner: '', poster: 'https://image.tmdb.org/t/p/w500/7s4Bq4QpS46V410o29D4f9jJ8D.jpg', overview: 'O encontro entre um cuidador de hospital psiquiátrico e uma autora de livros infantis com transtorno anti-social.', year: '2020' }
];

export const FALLBACK_COMEDY: TMDBMedia[] = [
  { id: '533535', title: 'Deadpool & Wolverine', category: 'Comédia / Ação', rating: '8.0', banner: '', poster: 'https://image.tmdb.org/t/p/w500/8cdWjvZpa84YrV5Np9SIFF4t2WM.jpg', overview: 'Deadpool é recrutado pela AVT para salvar seu universo e une forças com um Wolverine relutante de outra linha temporal.', year: '2024' },
  { id: '119051', title: 'Wandinha', category: 'Comédia / Mistério', rating: '8.5', banner: '', poster: 'https://image.tmdb.org/t/p/w500/a11F4xwiiBsZCrVvV4y5ohTYeju.jpg', overview: 'Inteligente, sarcástica e um pouco fria, Wandinha Addams investiga uma onda de assassinatos na Escola Nunca Mais.', year: '2022' }
];

export const FALLBACK_HORROR: TMDBMedia[] = [
  { id: '493529', title: 'Dungeons & Dragons: Honra Entre Rebeldes', category: 'Aventura / Fantasia', rating: '7.7', banner: '', poster: 'https://image.tmdb.org/t/p/w500/v4wtVePUX6y0332AsRoIfLThoR6.jpg', overview: 'Um bardo e um bando de aventureiros embarcam em uma jornada épica para recuperar um item perdido.', year: '2023' },
  { id: '507089', title: 'Five Nights at Freddy\'s', category: 'Terror / Suspense', rating: '7.7', banner: '', poster: 'https://image.tmdb.org/t/p/w500/A5XZ6ZLPHOOK3n5C7keXtEZo8vI.jpg', overview: 'Um segurança recém-contratado começa a descobrir que nada na pizzaria é o que parece.', year: '2023' }
];

export const FALLBACK_KDRAMAS: TMDBMedia[] = [
  { id: '94796', title: 'Pousando no Amor', category: 'K-Drama / Romance', rating: '8.8', banner: '', poster: 'https://image.tmdb.org/t/p/w500/9kMug5dBD452g5uC4UKe5g4uN.jpg', overview: 'Uma herdeira sul-coreana cai acidentalmente na Coreia do Norte e é protegida por um oficial do exército norte-coreano.', year: '2019' },
  { id: '110316', title: 'O Jogo do Lula', category: 'K-Drama / Suspense', rating: '7.8', banner: '', poster: 'https://image.tmdb.org/t/p/w500/dDlEmu3EZ0Pgg93K2SVNLCjCSvE.jpg', overview: 'Centenas de jogadores em dificuldades financeiras aceitam um convite estranho para competir em jogos infantis.', year: '2021' }
];

export const FALLBACK_FAMILY: TMDBMedia[] = [
  { id: '1022789', title: 'Divertida Mente 2', category: 'Animação / Família', rating: '8.6', banner: '', poster: 'https://image.tmdb.org/t/p/w500/vpnVM9B6NMmFJpZxOFVnLTYO5Ka.jpg', overview: 'Com a adolescência, a mente de Riley sofre uma demolição repentina para dar espaço a novas emoções.', year: '2024' },
  { id: '150540', title: 'Divertida Mente', category: 'Animação / Família', rating: '7.9', banner: '', poster: 'https://image.tmdb.org/t/p/w500/lRVCeVjfDDvHkzfBOELP1e6PLTx.jpg', overview: 'As emoções de uma garota entram em conflito quando sua família se muda para uma nova cidade.', year: '2015' }
];
