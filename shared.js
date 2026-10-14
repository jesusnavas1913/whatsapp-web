/**
 * WhatsApp Web - Motor y lógica compartida (Servidor Node.js + Navegador).
 * Un único reducer sincroniza el estado entre clientes y backend con soporte de número de celular.
 */
(function (root) {
  const GENERAL_CHAT = 'general';

  const DEFAULT_PROFILES = [
    {
      id: 'edwin',
      phone: '+57 300 111 2222',
      name: 'Edwin',
      avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Edwin&backgroundColor=00a884,128c7e',
      color: '#00a884',
      status: '¡Hola! Estoy usando WhatsApp Web 🚀',
      hasStory: true,
      story: {
        text: '¡Terminando el mejor clon de WhatsApp Web con inicio por número de teléfono! 🔥💻',
        time: 'Hace 2 horas',
        bg: 'linear-gradient(135deg, #00a884 0%, #128c7e 100%)'
      }
    },
    {
      id: 'amigo',
      phone: '+57 300 222 3333',
      name: 'Amigo',
      avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Amigo&backgroundColor=25d366,00a884',
      color: '#25d366',
      status: 'Disponible para chatear 📱',
      hasStory: true,
      story: {
        text: 'Probando la sincronización en tiempo real por número de WhatsApp ⚡',
        time: 'Hace 45 min',
        bg: 'linear-gradient(135deg, #25d366 0%, #075e54 100%)'
      }
    },
    {
      id: 'janus',
      phone: '+57 300 444 5555',
      name: 'Janus',
      avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Janus&backgroundColor=8b5cf6,3b82f6',
      color: '#8b5cf6',
      status: 'En el trabajo 💻🎧',
      hasStory: false
    },
    {
      id: 'maria',
      phone: '+57 300 777 8888',
      name: 'María',
      avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Maria&backgroundColor=f59e0b,ef4444',
      color: '#f59e0b',
      status: 'En una reunión ☕',
      hasStory: true,
      story: {
        text: '¡Un café bien cargado para empezar el día! ☕✨',
        time: 'Hace 3 horas',
        bg: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)'
      }
    }
  ];

  function normalizePhone(phone) {
    if (!phone) return '';
    return String(phone).replace(/[^\d+]/g, '');
  }

  function dmChatId(a, b) {
    return 'dm:' + [String(a), String(b)].sort().join(':');
  }

  function isDM(chatId) {
    return typeof chatId === 'string' && chatId.startsWith('dm:');
  }

  function dmParticipants(chatId) {
    return isDM(chatId) ? chatId.slice(3).split(':') : [];
  }

  function isParticipant(chatId, userId) {
    if (chatId === GENERAL_CHAT) return true;
    return dmParticipants(chatId).includes(String(userId));
  }

  function findUserByPhone(state, phone) {
    if (!state || !state.users || !phone) return null;
    const norm = normalizePhone(phone);
    if (!norm) return null;
    return Object.values(state.users).find(u => normalizePhone(u.phone) === norm || normalizePhone(u.id) === norm);
  }

  function createInitialState() {
    const now = Date.now();
    const [edwin, amigo, janus, maria] = DEFAULT_PROFILES;
    const users = {};
    DEFAULT_PROFILES.forEach(p => {
      users[p.id] = { ...p, lastSeen: now - Math.floor(Math.random() * 300000) };
    });

    const dmEA = dmChatId('edwin', 'amigo');
    const dmEJ = dmChatId('edwin', 'janus');
    const dmEM = dmChatId('edwin', 'maria');

    return {
      version: 2,
      users,
      chats: {
        [GENERAL_CHAT]: [
          {
            id: 'msg-g-1',
            chatId: GENERAL_CHAT,
            kind: 'text',
            senderId: edwin.id,
            senderName: edwin.name,
            senderAvatar: edwin.avatar,
            senderPhone: edwin.phone,
            text: '¡Bienvenidos al grupo oficial de WhatsApp Web! 🚀💬',
            timestamp: now - 1000 * 60 * 35,
            reactions: { amigo: '🔥', janus: '👍' },
            deliveredTo: ['amigo', 'janus', 'maria'],
            readBy: ['amigo', 'janus']
          },
          {
            id: 'msg-g-2',
            chatId: GENERAL_CHAT,
            kind: 'text',
            senderId: amigo.id,
            senderName: amigo.name,
            senderAvatar: amigo.avatar,
            senderPhone: amigo.phone,
            text: '¡Ahora podemos iniciar sesión con nuestro número de celular como en el WhatsApp real! 📱✨',
            timestamp: now - 1000 * 60 * 25,
            reactions: { edwin: '❤️', maria: '👏' },
            deliveredTo: ['edwin', 'janus', 'maria'],
            readBy: ['edwin', 'janus']
          },
          {
            id: 'msg-g-3',
            chatId: GENERAL_CHAT,
            kind: 'text',
            senderId: janus.id,
            senderName: janus.name,
            senderAvatar: janus.avatar,
            senderPhone: janus.phone,
            text: 'Cualquier mensaje que envíes a un número de celular llega directo al destinatario en tiempo real ⚡',
            timestamp: now - 1000 * 60 * 12,
            reactions: { edwin: '🙌' },
            deliveredTo: ['edwin', 'amigo', 'maria'],
            readBy: ['edwin', 'amigo']
          }
        ],
        [dmEA]: [
          {
            id: 'msg-ea-1',
            chatId: dmEA,
            kind: 'text',
            senderId: amigo.id,
            senderName: amigo.name,
            senderAvatar: amigo.avatar,
            senderPhone: amigo.phone,
            text: '¡Hola Edwin! Te estoy escribiendo directamente a tu número (+57 300 111 2222) 📱',
            timestamp: now - 1000 * 60 * 18,
            reactions: {},
            deliveredTo: ['edwin'],
            readBy: ['edwin']
          },
          {
            id: 'msg-ea-2',
            chatId: dmEA,
            kind: 'text',
            senderId: edwin.id,
            senderName: edwin.name,
            senderAvatar: edwin.avatar,
            senderPhone: edwin.phone,
            text: '¡Recibido al instante! El sistema por número de teléfono quedó impecable 🚀',
            timestamp: now - 1000 * 60 * 8,
            reactions: { amigo: '🔥' },
            deliveredTo: ['amigo'],
            readBy: ['amigo']
          }
        ],
        [dmEJ]: [
          {
            id: 'msg-ej-1',
            chatId: dmEJ,
            kind: 'text',
            senderId: janus.id,
            senderName: janus.name,
            senderAvatar: janus.avatar,
            senderPhone: janus.phone,
            text: 'Hola, tu cuenta con número de celular quedó verificada y lista para recibir mensajes.',
            timestamp: now - 1000 * 60 * 60,
            reactions: {},
            deliveredTo: ['edwin'],
            readBy: ['edwin']
          }
        ],
        [dmEM]: [
          {
            id: 'msg-em-1',
            chatId: dmEM,
            kind: 'text',
            senderId: maria.id,
            senderName: maria.name,
            senderAvatar: maria.avatar,
            senderPhone: maria.phone,
            text: '¡Hola! Escríbeme a este número cuando estés libre 👋',
            timestamp: now - 1000 * 60 * 90,
            reactions: { edwin: '👍' },
            deliveredTo: ['edwin'],
            readBy: []
          }
        ]
      }
    };
  }

  function findMessage(state, chatId, id) {
    const list = state.chats[chatId];
    return list ? list.find(m => m.id === id) : null;
  }

  function addUnique(arr, value) {
    if (!arr.includes(value)) { arr.push(value); return true; }
    return false;
  }

  /**
   * Aplica una acción al estado (lo muta). Devuelve true si algo cambió.
   */
  function applyAction(state, action) {
    if (!state || !action || !action.type) return false;

    switch (action.type) {
      case 'USER_UPSERT': {
        const u = action.user;
        if (!u || !u.id) return false;
        state.users[u.id] = {
          ...(state.users[u.id] || {}),
          ...u,
          lastSeen: action.at || Date.now()
        };
        return true;
      }

      case 'USER_SEEN': {
        const u = state.users[action.userId];
        if (!u) return false;
        u.lastSeen = action.at || Date.now();
        return true;
      }

      case 'MESSAGE_NEW': {
        const m = action.message;
        if (!m || !m.id || !m.chatId) return false;
        if (!state.chats[m.chatId]) state.chats[m.chatId] = [];
        if (state.chats[m.chatId].some(x => x.id === m.id)) return false;
        state.chats[m.chatId].push({
          reactions: {},
          deliveredTo: [],
          readBy: [],
          starredBy: [],
          ...m
        });
        if (state.chats[m.chatId].length > 800) state.chats[m.chatId].shift();
        return true;
      }

      case 'MESSAGE_EDIT': {
        const m = findMessage(state, action.chatId, action.id);
        if (!m || m.deleted || m.senderId !== action.userId) return false;
        m.text = String(action.text || '').slice(0, 4000);
        m.editedAt = action.at || Date.now();
        return true;
      }

      case 'MESSAGE_DELETE': {
        const m = findMessage(state, action.chatId, action.id);
        if (!m || m.senderId !== action.userId) return false;
        m.deleted = true;
        m.text = 'Este mensaje fue eliminado';
        delete m.image;
        delete m.audio;
        m.reactions = {};
        return true;
      }

      case 'REACT': {
        const m = findMessage(state, action.chatId, action.id);
        if (!m || m.deleted) return false;
        if (!m.reactions) m.reactions = {};
        if (m.reactions[action.userId] === action.emoji) {
          delete m.reactions[action.userId];
        } else {
          m.reactions[action.userId] = action.emoji;
        }
        return true;
      }

      case 'STAR_TOGGLE': {
        const m = findMessage(state, action.chatId, action.id);
        if (!m || m.deleted) return false;
        if (!m.starredBy) m.starredBy = [];
        if (m.starredBy.includes(action.userId)) {
          m.starredBy = m.starredBy.filter(u => u !== action.userId);
        } else {
          m.starredBy.push(action.userId);
        }
        return true;
      }

      case 'DELIVERED': {
        let changed = false;
        Object.keys(state.chats).forEach(chatId => {
          if (!isParticipant(chatId, action.userId)) return;
          state.chats[chatId].forEach(m => {
            if (m.senderId !== action.userId) {
              if (!m.deliveredTo) m.deliveredTo = [];
              changed = addUnique(m.deliveredTo, action.userId) || changed;
            }
          });
        });
        return changed;
      }

      case 'READ': {
        const list = state.chats[action.chatId];
        if (!list) return false;
        let changed = false;
        list.forEach(m => {
          if (m.senderId !== action.userId) {
            if (!m.deliveredTo) m.deliveredTo = [];
            if (!m.readBy) m.readBy = [];
            changed = addUnique(m.deliveredTo, action.userId) || changed;
            changed = addUnique(m.readBy, action.userId) || changed;
          }
        });
        return changed;
      }

      case 'CLEAR_CHAT': {
        if (!state.chats[action.chatId]) return false;
        state.chats[action.chatId] = [];
        return true;
      }

      default:
        return false;
    }
  }

  const api = {
    GENERAL_CHAT,
    DEFAULT_PROFILES,
    normalizePhone,
    dmChatId,
    isDM,
    dmParticipants,
    isParticipant,
    findUserByPhone,
    createInitialState,
    applyAction
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.EdwinShared = api;
    root.WhatsAppShared = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
