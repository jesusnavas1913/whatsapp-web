/**
 * WhatsApp Web - Motor completo de mensajería en tiempo real por WiFi y número celular.
 * Conexión directa entre Celular y PC sin bots ni respuestas simuladas.
 */

const EMOJIS = ['😀', '😂', '😍', '🔥', '👍', '❤️', '🎉', '🚀', '😎', '👏', '🙌', '💯', '✨', '⚡', '🤖', '💬', '👀', '🥳', '💪', '🤩', '👋', '☕', '🌟', '🤯', '👌', '🤝', '🍕', '🎮', '💡', '🙏', '🥺', '🤣', '😴', '😜', '😇'];

class WhatsAppWebApp {
  constructor() {
    this.storageKey = 'whatsapp_web_state_v3';
    this.userKey = 'whatsapp_web_session_user';
    this.soundKey = 'whatsapp_web_sound_pref';
    this.themeKey = 'whatsapp_web_theme_pref';

    this.shared = window.WhatsAppShared || window.EdwinShared;
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('whatsapp_web_channel') : null;

    // Sonidos activados por defecto
    this.soundsEnabled = localStorage.getItem(this.soundKey) !== 'false';

    // Cargar estado global
    this.state = this.loadState();

    // Sesión de usuario activo
    this.currentUser = this.loadSessionUser();

    // Chat activo por defecto: Chat directo 1-a-1 entre Edwin y Hermano
    if (this.currentUser && this.shared) {
      const otherId = this.currentUser.id === 'edwin' ? 'hermano' : 'edwin';
      this.activeChatId = this.shared.dmChatId(this.currentUser.id, otherId);
    } else {
      this.activeChatId = this.shared ? this.shared.GENERAL_CHAT : 'general';
    }

    // Variables de auth por celular
    this.pendingAuthPhone = '';
    this.pendingAuthCode = '';
    this.pendingAvatarSeed = 'Nuevo';

    // Conexión SSE
    this.eventSource = null;
    this.isServerConnected = false;

    // Estados transitorios de interfaz
    this.activeReply = null;
    this.activeImageAttachment = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecordingVoice = false;
    this.recordStartTime = null;
    this.recordTimerInterval = null;
    this.typingTimeout = null;
    this.storyTimer = null;
    this.callTimer = null;
    this.callSeconds = 0;
    this.activeAudioPlayer = null;
    this.activeFilter = 'all';

    // Web Audio API
    this.audioCtx = null;

    // Inicializar DOM y eventos
    this.initDOMElements();
    this.initEventListeners();
    this.applyTheme(localStorage.getItem(this.themeKey) || 'dark');

    // Conectar a SSE si hay servidor Node
    this.initSSEConnection();

    // Sincronización multi-pestaña (si se abren varias pestañas)
    if (this.channel) {
      this.channel.onmessage = (event) => this.handleChannelMessage(event.data);
    }
    window.addEventListener('storage', (e) => {
      if (e.key === this.storageKey) {
        this.state = this.loadState();
        this.renderContactsList();
        this.renderMessages();
      }
    });

    // Verificar si requiere login
    if (!this.currentUser) {
      this.openAuthScreen();
    } else {
      this.initAfterLogin();
    }
  }

  // --- Sesión de Usuario ---
  loadSessionUser() {
    const urlParams = new URLSearchParams(window.location.search);
    const paramUser = urlParams.get('user');
    const defaultProfiles = this.shared ? this.shared.DEFAULT_PROFILES : [];

    if (paramUser) {
      const pLower = paramUser.toLowerCase();
      const match = defaultProfiles.find(p => 
        p.id.toLowerCase() === pLower || 
        p.name.toLowerCase() === pLower ||
        (p.id === 'hermano' && (pLower === 'amigo' || pLower === 'celular')) ||
        this.shared.normalizePhone(p.phone) === this.shared.normalizePhone(paramUser)
      );
      if (match) {
        sessionStorage.setItem(this.userKey, JSON.stringify(match));
        return { ...match };
      }
    }

    const saved = sessionStorage.getItem(this.userKey);
    if (saved) {
      try {
        const u = JSON.parse(saved);
        if (u && u.id) return u;
      } catch (e) {}
    }

    // Si es móvil o pantalla táctil pequeña (el celular de tu hermano), entrar como Hermano.
    // Si es PC o pantalla grande, entrar como Edwin.
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (typeof window !== 'undefined' && window.innerWidth <= 768);
    const defaultUser = isMobile ? (defaultProfiles.find(p => p.id === 'hermano') || defaultProfiles[1]) : defaultProfiles[0];
    if (defaultUser) {
      sessionStorage.setItem(this.userKey, JSON.stringify(defaultUser));
      return { ...defaultUser };
    }
    return defaultProfiles[0] || null;
  }

  setLoggedInUser(user) {
    this.currentUser = { ...user };
    sessionStorage.setItem(this.userKey, JSON.stringify(this.currentUser));
    this.dom.authOverlay.style.display = 'none';

    // Registrar usuario en el estado
    this.state.users[this.currentUser.id] = { ...this.currentUser };
    this.saveState();

    this.broadcastAction({ type: 'USER_UPSERT', user: this.currentUser, at: Date.now() });
    this.initSSEConnection();
    this.initAfterLogin();
    this.showToast(`¡Conectado como ${this.currentUser.name}! 📱`);
  }

  initAfterLogin() {
    this.renderUserProfile();
    this.renderContactsList();
    this.openChat(this.activeChatId);
    this.renderEmojiPicker();

    // Notificar si está en file:// en lugar del servidor localhost:3000
    if (window.location.protocol === 'file:') {
      setTimeout(() => {
        this.showToast('💡 Para conectar por WiFi con tu hermano, abre http://localhost:3000');
      }, 1500);
    }
  }

  logout() {
    sessionStorage.removeItem(this.userKey);
    this.currentUser = null;
    if (this.eventSource) {
      try { this.eventSource.close(); } catch (e) {}
      this.eventSource = null;
    }
    this.openAuthScreen();
    this.showToast('Sesión cerrada');
  }

  openAuthScreen() {
    this.dom.authStepPhone.style.display = 'block';
    this.dom.authStepCode.style.display = 'none';
    this.dom.authStepProfile.style.display = 'none';
    this.dom.authPhoneInput.value = '';
    this.dom.authOverlay.style.display = 'flex';
  }

  // --- Estado Global ---
  loadState() {
    try {
      const local = localStorage.getItem(this.storageKey);
      if (local) {
        const parsed = JSON.parse(local);
        if (parsed && parsed.chats) return parsed;
      }
    } catch (e) {}

    const initial = this.shared ? this.shared.createInitialState() : {
      version: 3,
      users: {},
      chats: { general: [] }
    };
    this.saveState(initial);
    return initial;
  }

  saveState(st = this.state) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(st));
    } catch (e) {}
  }

  applyLocalAction(action) {
    if (!this.shared || !this.shared.applyAction(this.state, action)) return false;
    this.saveState();
    return true;
  }

  broadcastAction(action) {
    this.applyLocalAction(action);
    if (this.channel) {
      this.channel.postMessage({ type: 'ACTION', action });
    }
    if (this.isServerConnected) {
      fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action)
      }).catch(() => {});
    }
  }

  handleChannelMessage(payload) {
    if (!payload) return;

    if (payload.type === 'ACTION' && payload.action) {
      this.applyLocalAction(payload.action);
      this.renderContactsList();
      this.renderMessages();

      if (payload.action.type === 'MESSAGE_NEW') {
        const m = payload.action.message;
        if (m && (!this.currentUser || m.senderId !== this.currentUser.id)) {
          if (m.chatId === this.activeChatId) {
            this.broadcastAction({ type: 'READ', chatId: this.activeChatId, userId: this.currentUser.id });
          }
          this.playBeepSound('receive');
        }
      }
    } else if (payload.type === 'TYPING') {
      if (!this.currentUser || payload.userId !== this.currentUser.id) {
        this.updateContactTyping(payload.chatId, payload.userName, payload.isTyping);
      }
    }
  }

  // --- Conexión Server SSE (Para chatear por WiFi entre Celular y PC) ---
  initSSEConnection() {
    this.isServerConnected = false;
    if (typeof EventSource === 'undefined' || !this.currentUser) return;

    if (this.eventSource) {
      try { this.eventSource.close(); } catch (e) {}
      this.eventSource = null;
    }

    if (window.location.protocol === 'file:') {
      this.dom.connectionStatusText.textContent = 'Modo Local (file://)';
      return;
    }

    try {
      const userParam = encodeURIComponent(JSON.stringify(this.currentUser));
      this.eventSource = new EventSource(`/api/events?user=${userParam}`);

      this.eventSource.onopen = () => {
        this.isServerConnected = true;
        this.dom.connectionStatusText.textContent = 'En línea (WiFi)';
      };

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'STATE' && data.state) {
            this.state = data.state;
            this.saveState();
            this.renderContactsList();
            this.renderMessages();
          } else if (data.type === 'ACTION' && data.action) {
            this.applyLocalAction(data.action);
            this.renderContactsList();
            this.renderMessages();
            if (data.action.type === 'MESSAGE_NEW' && (!this.currentUser || data.action.message.senderId !== this.currentUser.id)) {
              if (data.action.message.chatId === this.activeChatId && this.currentUser) {
                this.broadcastAction({ type: 'READ', chatId: this.activeChatId, userId: this.currentUser.id });
              }
              this.playBeepSound('receive');
            }
          } else if (data.type === 'TYPING') {
            if (!this.currentUser || data.userId !== this.currentUser.id) {
              this.updateContactTyping(data.chatId, data.userName, data.isTyping);
            }
          }
        } catch (err) {}
      };

      this.eventSource.onerror = () => {
        this.isServerConnected = false;
        this.dom.connectionStatusText.textContent = 'Reconectando WiFi...';
      };
    } catch (e) {
      this.isServerConnected = false;
    }
  }

  // --- Sonidos Procedimentales ---
  playBeepSound(type = 'send') {
    if (!this.soundsEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!this.audioCtx) this.audioCtx = new AudioContext();
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      if (type === 'send') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(620, now);
        osc.frequency.exponentialRampToValueAtTime(940, now + 0.08);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.11);
      } else if (type === 'receive') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(750, now);
        osc.frequency.setValueAtTime(1120, now + 0.09);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.23);
      } else if (type === 'ringtone') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(480, now);
        osc.frequency.setValueAtTime(440, now + 0.1);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.start(now);
        osc.stop(now + 0.46);
      }
    } catch (e) {}
  }

  // --- Elementos del DOM ---
  initDOMElements() {
    this.dom = {
      appContainer: document.getElementById('appContainer'),
      sidebar: document.getElementById('sidebar'),
      myProfileBtn: document.getElementById('myProfileBtn'),
      myAvatarImg: document.getElementById('myAvatarImg'),
      myUserName: document.getElementById('myUserName'),
      myUserPhone: document.getElementById('myUserPhone'),
      statusStoriesBtn: document.getElementById('statusStoriesBtn'),
      statusUnreadDot: document.getElementById('statusUnreadDot'),
      newChatBtn: document.getElementById('newChatBtn'),
      switchUserQuickBtn: document.getElementById('switchUserQuickBtn'),
      sidebarMenuBtn: document.getElementById('sidebarMenuBtn'),
      sidebarMenuDropdown: document.getElementById('sidebarMenuDropdown'),
      menuItemNewGroup: document.getElementById('menuItemNewGroup'),
      menuItemQrPair: document.getElementById('menuItemQrPair'),
      menuItemDualTab: document.getElementById('menuItemDualTab'),
      menuItemToggleTheme: document.getElementById('menuItemToggleTheme'),
      themeMenuText: document.getElementById('themeMenuText'),
      menuItemSwitchUser: document.getElementById('menuItemSwitchUser'),
      menuItemLogout: document.getElementById('menuItemLogout'),
      menuItemClearAll: document.getElementById('menuItemClearAll'),
      wifiBanner: document.getElementById('wifiBanner'),
      wifiUrlText: document.getElementById('wifiUrlText'),
      wifiShowQrBtn: document.getElementById('wifiShowQrBtn'),
      wifiCopyUrlBtn: document.getElementById('wifiCopyUrlBtn'),
      searchInput: document.getElementById('searchInput'),
      clearSearchBtn: document.getElementById('clearSearchBtn'),
      filterPills: document.querySelectorAll('.filter-pill'),
      contactsList: document.getElementById('contactsList'),
      soundToggleBtn: document.getElementById('soundToggleBtn'),
      audioOnIcon: document.querySelector('.audio-on-icon'),
      audioOffIcon: document.querySelector('.audio-off-icon'),
      connectionStatusText: document.getElementById('connectionStatusText'),
      qrCodeLinkBtn: document.getElementById('qrCodeLinkBtn'),

      // Chat Main Area
      welcomeScreen: document.getElementById('welcomeScreen'),
      activeChatWrapper: document.getElementById('activeChatWrapper'),
      mobileBackBtn: document.getElementById('mobileBackBtn'),
      chatPartnerAvatar: document.getElementById('chatPartnerAvatar'),
      partnerAvatarWrapper: document.getElementById('partnerAvatarWrapper'),
      partnerStatusDot: document.getElementById('partnerStatusDot'),
      chatPartnerName: document.getElementById('chatPartnerName'),
      chatPartnerPhone: document.getElementById('chatPartnerPhone'),
      partnerStatusText: document.getElementById('partnerStatusText'),
      typingIndicatorHeader: document.getElementById('typingIndicatorHeader'),
      whoIsTypingText: document.getElementById('whoIsTypingText'),
      voiceCallBtn: document.getElementById('voiceCallBtn'),
      videoCallBtn: document.getElementById('videoCallBtn'),
      chatMenuBtn: document.getElementById('chatMenuBtn'),
      chatMenuDropdown: document.getElementById('chatMenuDropdown'),
      chatMenuInfo: document.getElementById('chatMenuInfo'),
      chatMenuSearch: document.getElementById('chatMenuSearch'),
      chatMenuMute: document.getElementById('chatMenuMute'),
      chatMenuClear: document.getElementById('chatMenuClear'),
      messagesContainer: document.getElementById('messagesContainer'),
      messagesList: document.getElementById('messagesList'),
      scrollToBottomBtn: document.getElementById('scrollToBottomBtn'),
      unreadCountBadge: document.getElementById('unreadCountBadge'),

      // Input Bottom Bar
      replyBar: document.getElementById('replyBar'),
      replyToUser: document.getElementById('replyToUser'),
      replyToText: document.getElementById('replyToText'),
      cancelReplyBtn: document.getElementById('cancelReplyBtn'),
      imagePreviewBar: document.getElementById('imagePreviewBar'),
      imagePreviewThumb: document.getElementById('imagePreviewThumb'),
      previewFileName: document.getElementById('previewFileName'),
      cancelImageBtn: document.getElementById('cancelImageBtn'),
      voiceRecordingBar: document.getElementById('voiceRecordingBar'),
      recordingTimerText: document.getElementById('recordingTimerText'),
      cancelRecordBtn: document.getElementById('cancelRecordBtn'),
      sendRecordBtn: document.getElementById('sendRecordBtn'),
      emojiPicker: document.getElementById('emojiPicker'),
      emojiGrid: document.getElementById('emojiGrid'),
      closeEmojiBtn: document.getElementById('closeEmojiBtn'),
      emojiBtn: document.getElementById('emojiBtn'),
      attachBtn: document.getElementById('attachBtn'),
      attachmentMenu: document.getElementById('attachmentMenu'),
      imageInput: document.getElementById('imageInput'),
      cameraInput: document.getElementById('cameraInput'),
      cameraOptionBtn: document.getElementById('cameraOptionBtn'),
      docOptionBtn: document.getElementById('docOptionBtn'),
      messageInput: document.getElementById('messageInput'),
      audioRecordBtn: document.getElementById('audioRecordBtn'),
      sendBtn: document.getElementById('sendBtn'),

      // Auth Overlay
      authOverlay: document.getElementById('authOverlay'),
      authStepPhone: document.getElementById('authStepPhone'),
      authCountrySelect: document.getElementById('authCountrySelect'),
      authCountryCodeDisplay: document.getElementById('authCountryCodeDisplay'),
      authPhoneInput: document.getElementById('authPhoneInput'),
      authSendCodeBtn: document.getElementById('authSendCodeBtn'),
      authStepCode: document.getElementById('authStepCode'),
      verifyPhoneDisplay: document.getElementById('verifyPhoneDisplay'),
      simulatedCodeText: document.getElementById('simulatedCodeText'),
      autoFillCodeBtn: document.getElementById('autoFillCodeBtn'),
      authCodeInput: document.getElementById('authCodeInput'),
      authBackToPhoneBtn: document.getElementById('authBackToPhoneBtn'),
      authVerifyCodeBtn: document.getElementById('authVerifyCodeBtn'),
      authStepProfile: document.getElementById('authStepProfile'),
      newProfileAvatarPreview: document.getElementById('newProfileAvatarPreview'),
      randomizeAvatarBtn: document.getElementById('randomizeAvatarBtn'),
      newProfileNameInput: document.getElementById('newProfileNameInput'),
      newProfileStatusInput: document.getElementById('newProfileStatusInput'),
      authSaveProfileBtn: document.getElementById('authSaveProfileBtn'),
      quickAccBtns: document.querySelectorAll('.quick-acc-btn'),
      directNameInput: document.getElementById('directNameInput'),
      directEnterBtn: document.getElementById('directEnterBtn'),

      // Modals
      storiesModal: document.getElementById('storiesModal'),
      storyProgressFill: document.getElementById('storyProgressFill'),
      storyUserAvatar: document.getElementById('storyUserAvatar'),
      storyUserName: document.getElementById('storyUserName'),
      storyTime: document.getElementById('storyTime'),
      storyBody: document.getElementById('storyBody'),
      storyContentText: document.getElementById('storyContentText'),
      storyReplyInput: document.getElementById('storyReplyInput'),
      sendStoryReplyBtn: document.getElementById('sendStoryReplyBtn'),
      closeStoryBtn: document.getElementById('closeStoryBtn'),

      callModal: document.getElementById('callModal'),
      callAvatarImg: document.getElementById('callAvatarImg'),
      callContactName: document.getElementById('callContactName'),
      callStatusLabel: document.getElementById('callStatusLabel'),
      callTimerLabel: document.getElementById('callTimerLabel'),
      callMuteBtn: document.getElementById('callMuteBtn'),
      callHangupBtn: document.getElementById('callHangupBtn'),
      callVideoToggleBtn: document.getElementById('callVideoToggleBtn'),

      qrModal: document.getElementById('qrModal'),
      closeQrModalBtn: document.getElementById('closeQrModalBtn'),
      qrSimulatePairBtn: document.getElementById('qrSimulatePairBtn'),

      switchUserModal: document.getElementById('switchUserModal'),
      closeModalBtn: document.getElementById('closeModalBtn'),
      userSelectGrid: document.getElementById('userSelectGrid'),
      btnOpenPhoneAuthModal: document.getElementById('btnOpenPhoneAuthModal'),

      newChatModal: document.getElementById('newChatModal'),
      closeNewChatModalBtn: document.getElementById('closeNewChatModalBtn'),
      tabBtnChatPhone: document.getElementById('tabBtnChatPhone'),
      tabBtnChatList: document.getElementById('tabBtnChatList'),
      tabContentPhone: document.getElementById('tabContentPhone'),
      tabContentList: document.getElementById('tabContentList'),
      newChatCountryCode: document.getElementById('newChatCountryCode'),
      newChatPhoneInput: document.getElementById('newChatPhoneInput'),
      newChatOptionalName: document.getElementById('newChatOptionalName'),
      startChatByPhoneBtn: document.getElementById('startChatByPhoneBtn'),
      newChatContactsList: document.getElementById('newChatContactsList'),

      imageLightboxModal: document.getElementById('imageLightboxModal'),
      closeLightboxBtn: document.getElementById('closeLightboxBtn'),
      lightboxImg: document.getElementById('lightboxImg'),
      lightboxCaption: document.getElementById('lightboxCaption')
    };

    this.updateSoundButtonUI();
  }

  // --- Listeners de Eventos ---
  initEventListeners() {
    // 1. Envío de Mensajes (Solo mensajes reales de usuario)
    this.dom.sendBtn.addEventListener('click', () => this.sendMessage());
    this.dom.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.dom.messageInput.addEventListener('input', () => {
      this.dom.messageInput.style.height = 'auto';
      this.dom.messageInput.style.height = Math.min(this.dom.messageInput.scrollHeight, 120) + 'px';
      this.handleTyping();
    });

    this.dom.mobileBackBtn.addEventListener('click', () => {
      this.dom.appContainer.classList.remove('chat-open');
    });

    // 2. Auth por Celular
    this.dom.authCountrySelect.addEventListener('change', () => {
      this.dom.authCountryCodeDisplay.textContent = this.dom.authCountrySelect.value;
    });

    this.dom.authSendCodeBtn.addEventListener('click', () => this.handleAuthSendSMS());
    this.dom.authBackToPhoneBtn.addEventListener('click', () => {
      this.dom.authStepPhone.style.display = 'block';
      this.dom.authStepCode.style.display = 'none';
    });

    this.dom.autoFillCodeBtn.addEventListener('click', () => {
      this.dom.authCodeInput.value = this.pendingAuthCode;
      this.handleAuthVerifyCode();
    });

    this.dom.authVerifyCodeBtn.addEventListener('click', () => this.handleAuthVerifyCode());

    this.dom.randomizeAvatarBtn.addEventListener('click', () => {
      this.pendingAvatarSeed = 'Avatar_' + Math.floor(Math.random() * 10000);
      this.dom.newProfileAvatarPreview.src = `https://api.dicebear.com/7.x/bottts/svg?seed=${this.pendingAvatarSeed}&backgroundColor=00a884,128c7e`;
    });

    this.dom.authSaveProfileBtn.addEventListener('click', () => this.handleAuthSaveNewProfile());

    // Cuentas rápidas de prueba y selección 1-clic (sin códigos)
    this.dom.quickAccBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const profiles = this.shared.DEFAULT_PROFILES;
        const found = profiles.find(p => p.id === id);
        if (found) {
          this.setLoggedInUser(found);
        }
      });
    });

    if (this.dom.directEnterBtn && this.dom.directNameInput) {
      this.dom.directEnterBtn.addEventListener('click', () => {
        const name = this.dom.directNameInput.value.trim();
        if (!name) return;
        const id = 'user_' + Date.now().toString(36);
        const user = {
          id,
          name,
          phone: '+57 300 ' + Math.floor(1000000 + Math.random() * 9000000),
          avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}&backgroundColor=00a884,128c7e`,
          color: '#00a884',
          status: '¡Hola! Estoy usando WhatsApp Web 🚀'
        };
        this.setLoggedInUser(user);
      });
      this.dom.directNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.dom.directEnterBtn.click();
      });
    }

    // Logout
    this.dom.menuItemLogout.addEventListener('click', () => {
      this.closeAllMenus();
      this.logout();
    });

    // Tema
    this.dom.menuItemToggleTheme.addEventListener('click', () => {
      const isDark = document.body.classList.contains('dark-theme');
      this.applyTheme(isDark ? 'light' : 'dark');
      this.dom.sidebarMenuDropdown.style.display = 'none';
    });

    // Sonidos toggle
    this.dom.soundToggleBtn.addEventListener('click', () => {
      this.soundsEnabled = !this.soundsEnabled;
      localStorage.setItem(this.soundKey, this.soundsEnabled ? 'true' : 'false');
      this.updateSoundButtonUI();
      if (this.soundsEnabled) this.playBeepSound('send');
    });

    // Menús dropdown
    this.dom.sidebarMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isShown = this.dom.sidebarMenuDropdown.style.display === 'block';
      this.closeAllMenus();
      this.dom.sidebarMenuDropdown.style.display = isShown ? 'none' : 'block';
    });

    this.dom.chatMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isShown = this.dom.chatMenuDropdown.style.display === 'block';
      this.closeAllMenus();
      this.dom.chatMenuDropdown.style.display = isShown ? 'none' : 'block';
    });

    document.addEventListener('click', () => this.closeAllMenus());

    // Banner WiFi
    if (this.dom.wifiShowQrBtn) {
      this.dom.wifiShowQrBtn.addEventListener('click', () => {
        this.dom.qrModal.style.display = 'flex';
      });
    }
    if (this.dom.wifiCopyUrlBtn) {
      this.dom.wifiCopyUrlBtn.addEventListener('click', () => {
        const url = 'http://192.168.101.73:3000';
        navigator.clipboard.writeText(url);
        this.showToast('Dirección copiada: http://192.168.101.73:3000 📱');
      });
    }

    // Switch user rápido
    this.dom.switchUserQuickBtn.addEventListener('click', () => {
      const defaultProfiles = this.shared.DEFAULT_PROFILES;
      const nextUser = (this.currentUser && this.currentUser.id === 'edwin') ? defaultProfiles[1] : defaultProfiles[0];
      this.setLoggedInUser(nextUser);
    });

    // Modal de switch user
    this.dom.myProfileBtn.addEventListener('click', () => this.openUserModal());
    this.dom.menuItemSwitchUser.addEventListener('click', () => {
      this.dom.sidebarMenuDropdown.style.display = 'none';
      this.openUserModal();
    });
    this.dom.closeModalBtn.addEventListener('click', () => {
      this.dom.switchUserModal.style.display = 'none';
    });
    this.dom.btnOpenPhoneAuthModal.addEventListener('click', () => {
      this.dom.switchUserModal.style.display = 'none';
      this.openAuthScreen();
    });

    // Modal de Nuevo Chat con Número
    this.dom.newChatBtn.addEventListener('click', () => this.openNewChatModal());
    this.dom.closeNewChatModalBtn.addEventListener('click', () => {
      this.dom.newChatModal.style.display = 'none';
    });
    this.dom.menuItemNewGroup.addEventListener('click', () => {
      this.dom.sidebarMenuDropdown.style.display = 'none';
      this.openChat(this.shared.GENERAL_CHAT);
    });

    // Tabs del modal Nuevo Chat
    this.dom.tabBtnChatPhone.addEventListener('click', () => {
      this.dom.tabBtnChatPhone.classList.add('active');
      this.dom.tabBtnChatList.classList.remove('active');
      this.dom.tabContentPhone.style.display = 'block';
      this.dom.tabContentList.style.display = 'none';
    });
    this.dom.tabBtnChatList.addEventListener('click', () => {
      this.dom.tabBtnChatList.classList.add('active');
      this.dom.tabBtnChatPhone.classList.remove('active');
      this.dom.tabContentList.style.display = 'block';
      this.dom.tabContentPhone.style.display = 'none';
    });

    // Iniciar chat por número directo
    this.dom.startChatByPhoneBtn.addEventListener('click', () => this.handleStartChatByPhoneNumber());

    // Modal QR
    const openQRModal = () => {
      this.dom.qrModal.style.display = 'flex';
      this.dom.sidebarMenuDropdown.style.display = 'none';
    };
    this.dom.menuItemQrPair.addEventListener('click', openQRModal);
    this.dom.qrCodeLinkBtn.addEventListener('click', openQRModal);
    this.dom.closeQrModalBtn.addEventListener('click', () => {
      this.dom.qrModal.style.display = 'none';
    });
    this.dom.qrSimulatePairBtn.addEventListener('click', () => {
      this.dom.qrModal.style.display = 'none';
      this.playBeepSound('receive');
      this.showToast('¡Abre http://192.168.101.73:3000 en el celular de tu hermano! 📱');
    });

    // Estados
    this.dom.statusStoriesBtn.addEventListener('click', () => this.openStoriesViewer());
    this.dom.closeStoryBtn.addEventListener('click', () => this.closeStoriesViewer());
    this.dom.sendStoryReplyBtn.addEventListener('click', () => {
      this.showToast('Reacción enviada al estado ❤️');
      this.closeStoriesViewer();
    });

    // Llamadas
    this.dom.voiceCallBtn.addEventListener('click', () => this.startSimulatedCall('audio'));
    this.dom.videoCallBtn.addEventListener('click', () => this.startSimulatedCall('video'));
    this.dom.callHangupBtn.addEventListener('click', () => this.endSimulatedCall());
    this.dom.callMuteBtn.addEventListener('click', () => {
      this.dom.callMuteBtn.classList.toggle('active');
    });

    // Vaciar chats
    this.dom.menuItemClearAll.addEventListener('click', () => {
      if (confirm('¿Deseas vaciar todas las conversaciones de WhatsApp Web?')) {
        this.broadcastAction({ type: 'CLEAR_ALL', at: Date.now() });
        this.renderContactsList();
        this.renderMessages();
        this.dom.sidebarMenuDropdown.style.display = 'none';
        this.showToast('Historial vaciado');
      }
    });
    this.dom.chatMenuClear.addEventListener('click', () => {
      if (confirm('¿Vaciar los mensajes de este chat?')) {
        this.broadcastAction({ type: 'CLEAR_CHAT', chatId: this.activeChatId });
        this.dom.chatMenuDropdown.style.display = 'none';
      }
    });

    // Búsqueda
    this.dom.searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      this.dom.clearSearchBtn.style.display = q ? 'block' : 'none';
      this.renderContactsList(q);
    });
    this.dom.clearSearchBtn.addEventListener('click', () => {
      this.dom.searchInput.value = '';
      this.dom.clearSearchBtn.style.display = 'none';
      this.renderContactsList();
    });

    this.dom.filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        this.dom.filterPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.activeFilter = pill.getAttribute('data-filter');
        this.renderContactsList(this.dom.searchInput.value.trim().toLowerCase());
      });
    });

    // Reply
    this.dom.cancelReplyBtn.addEventListener('click', () => {
      this.activeReply = null;
      this.dom.replyBar.style.display = 'none';
    });

    // Archivos e imágenes
    this.dom.attachBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isShown = this.dom.attachmentMenu.style.display === 'flex';
      this.dom.attachmentMenu.style.display = isShown ? 'none' : 'flex';
    });
    this.dom.imageInput.addEventListener('change', (e) => this.handleImageSelect(e));
    this.dom.cameraInput.addEventListener('change', (e) => this.handleImageSelect(e));
    this.dom.docOptionBtn.addEventListener('click', () => {
      this.dom.attachmentMenu.style.display = 'none';
      this.dom.imageInput.click();
    });
    this.dom.cancelImageBtn.addEventListener('click', () => {
      this.activeImageAttachment = null;
      this.dom.imagePreviewBar.style.display = 'none';
      this.dom.imageInput.value = '';
    });

    // Lightbox
    this.dom.closeLightboxBtn.addEventListener('click', () => {
      this.dom.imageLightboxModal.style.display = 'none';
    });

    // Emojis
    this.dom.emojiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = this.dom.emojiPicker.style.display === 'block';
      this.dom.emojiPicker.style.display = isVisible ? 'none' : 'block';
    });
    this.dom.closeEmojiBtn.addEventListener('click', () => {
      this.dom.emojiPicker.style.display = 'none';
    });

    // Grabación de voz
    this.dom.audioRecordBtn.addEventListener('click', () => this.startVoiceRecording());
    this.dom.cancelRecordBtn.addEventListener('click', () => this.cancelVoiceRecording());
    this.dom.sendRecordBtn.addEventListener('click', () => this.stopAndSendVoiceRecording());

    // Scroll
    this.dom.messagesContainer.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = this.dom.messagesContainer;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 120;
      this.dom.scrollToBottomBtn.style.display = isNearBottom ? 'none' : 'flex';
    });
    this.dom.scrollToBottomBtn.addEventListener('click', () => this.scrollToBottom());
  }

  // --- Lógica de Autenticación por Celular (SMS Simulado) ---
  handleAuthSendSMS() {
    const rawNumber = this.dom.authPhoneInput.value.trim();
    if (!rawNumber || rawNumber.length < 6) {
      alert('Por favor introduce un número de celular válido.');
      return;
    }

    const prefix = this.dom.authCountryCodeDisplay.textContent.trim();
    const fullPhone = `${prefix} ${rawNumber}`;
    this.pendingAuthPhone = fullPhone;

    const randomCode = String(Math.floor(100000 + Math.random() * 900000));
    this.pendingAuthCode = randomCode;

    this.dom.verifyPhoneDisplay.textContent = fullPhone;
    this.dom.simulatedCodeText.innerHTML = `Tu código de WhatsApp Web es: <strong>${randomCode.slice(0, 3)}-${randomCode.slice(3)}</strong>`;
    this.dom.authCodeInput.value = '';

    this.dom.authStepPhone.style.display = 'none';
    this.dom.authStepCode.style.display = 'block';

    this.playBeepSound('receive');
    this.showToast(`📩 SMS con código recibido para ${fullPhone}`);
  }

  handleAuthVerifyCode() {
    const entered = this.dom.authCodeInput.value.replace(/\D/g, '');
    if (entered !== this.pendingAuthCode && entered !== '123456') {
      alert('Código incorrecto. Ingresa el código SMS de 6 dígitos que apareció en pantalla o presiona Autocompletar.');
      return;
    }

    const existingUser = this.shared.findUserByPhone(this.state, this.pendingAuthPhone);
    if (existingUser) {
      this.setLoggedInUser(existingUser);
    } else {
      this.dom.authStepCode.style.display = 'none';
      this.dom.authStepProfile.style.display = 'block';
      this.dom.newProfileNameInput.value = '';
      this.dom.newProfileNameInput.focus();
    }
  }

  handleAuthSaveNewProfile() {
    const name = this.dom.newProfileNameInput.value.trim() || 'Usuario WhatsApp';
    const status = this.dom.newProfileStatusInput.value.trim() || '¡Hola! Estoy usando WhatsApp 🚀';
    const norm = this.shared.normalizePhone(this.pendingAuthPhone);
    const id = 'user_' + norm.replace('+', '');

    const newUser = {
      id,
      phone: this.pendingAuthPhone,
      name,
      status,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${this.pendingAvatarSeed}&backgroundColor=00a884,128c7e`,
      color: '#00a884',
      hasStory: false
    };

    this.setLoggedInUser(newUser);
  }

  // --- Iniciar Chat Directo por Número Móvil ---
  handleStartChatByPhoneNumber() {
    const rawNumber = this.dom.newChatPhoneInput.value.trim();
    if (!rawNumber || rawNumber.length < 6) {
      alert('Por favor ingresa un número de teléfono válido.');
      return;
    }

    const countryCode = this.dom.newChatCountryCode.value;
    const fullPhone = `${countryCode} ${rawNumber}`;
    const customName = this.dom.newChatOptionalName.value.trim();

    let targetUser = this.shared.findUserByPhone(this.state, fullPhone);

    if (!targetUser) {
      const norm = this.shared.normalizePhone(fullPhone);
      const targetId = 'c_' + norm.replace('+', '');
      targetUser = {
        id: targetId,
        phone: fullPhone,
        name: customName || fullPhone,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(fullPhone)}&backgroundColor=25d366,00a884`,
        color: '#25d366',
        status: 'Disponible en WhatsApp'
      };
      this.state.users[targetId] = targetUser;
      this.saveState();
      this.broadcastAction({ type: 'USER_UPSERT', user: targetUser, at: Date.now() });
    }

    const chatId = this.shared.dmChatId(this.currentUser.id, targetUser.id);
    this.openChat(chatId);
    this.dom.newChatModal.style.display = 'none';
    this.dom.newChatPhoneInput.value = '';
    this.dom.newChatOptionalName.value = '';
    this.showToast(`Conversación abierta con ${targetUser.name} (${fullPhone}) 📱`);
  }

  closeAllMenus() {
    this.dom.sidebarMenuDropdown.style.display = 'none';
    this.dom.chatMenuDropdown.style.display = 'none';
    this.dom.attachmentMenu.style.display = 'none';
    this.dom.emojiPicker.style.display = 'none';
    document.querySelectorAll('.bubble-context-menu').forEach(m => m.remove());
  }

  applyTheme(theme) {
    if (theme === 'light') {
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
      this.dom.themeMenuText.textContent = 'Modo Oscuro';
      localStorage.setItem(this.themeKey, 'light');
    } else {
      document.body.classList.remove('light-theme');
      document.body.classList.add('dark-theme');
      this.dom.themeMenuText.textContent = 'Modo Claro';
      localStorage.setItem(this.themeKey, 'dark');
    }
  }

  updateSoundButtonUI() {
    this.dom.audioOnIcon.style.display = this.soundsEnabled ? 'block' : 'none';
    this.dom.audioOffIcon.style.display = this.soundsEnabled ? 'none' : 'block';
  }

  // --- Envío de Mensajes (Solo interacción real) ---
  sendMessage() {
    if (!this.currentUser) {
      this.openAuthScreen();
      return;
    }

    const text = this.dom.messageInput.value.trim();
    if (!text && !this.activeImageAttachment) return;

    const newMsg = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      chatId: this.activeChatId,
      kind: this.activeImageAttachment ? 'image' : 'text',
      senderId: this.currentUser.id,
      senderName: this.currentUser.name,
      senderAvatar: this.currentUser.avatar,
      senderPhone: this.currentUser.phone,
      text: text,
      image: this.activeImageAttachment || null,
      replyTo: this.activeReply || null,
      timestamp: Date.now(),
      reactions: {},
      deliveredTo: [],
      readBy: [],
      starredBy: []
    };

    this.broadcastAction({ type: 'MESSAGE_NEW', message: newMsg });
    this.playBeepSound('send');

    // Resetear campos
    this.dom.messageInput.value = '';
    this.dom.messageInput.style.height = 'auto';
    this.activeReply = null;
    this.dom.replyBar.style.display = 'none';
    this.activeImageAttachment = null;
    this.dom.imagePreviewBar.style.display = 'none';
    this.dom.imageInput.value = '';

    this.broadcastTyping(false);
    this.renderMessages();
    this.renderContactsList();
    this.scrollToBottom();
    // CERO respuestas automáticas de bot: solo tu hermano responderá desde su celular
  }

  // --- Notas de Voz Reales ---
  async startVoiceRecording() {
    if (this.isRecordingVoice) return;

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.mediaRecorder = new MediaRecorder(stream);
        this.audioChunks = [];
        this.mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) this.audioChunks.push(e.data);
        };
        this.mediaRecorder.start();
      }
    } catch (err) {
      this.mediaRecorder = null;
    }

    this.isRecordingVoice = true;
    this.recordStartTime = Date.now();
    this.dom.voiceRecordingBar.style.display = 'flex';
    this.dom.recordingTimerText.textContent = '0:00';

    clearInterval(this.recordTimerInterval);
    this.recordTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.recordStartTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      this.dom.recordingTimerText.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }, 1000);
  }

  cancelVoiceRecording() {
    if (!this.isRecordingVoice) return;
    this.isRecordingVoice = false;
    clearInterval(this.recordTimerInterval);
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    this.dom.voiceRecordingBar.style.display = 'none';
    this.showToast('Nota de voz cancelada');
  }

  stopAndSendVoiceRecording() {
    if (!this.isRecordingVoice) return;
    const elapsed = Math.max(1, Math.floor((Date.now() - this.recordStartTime) / 1000));
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const durationFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    clearInterval(this.recordTimerInterval);
    this.isRecordingVoice = false;
    this.dom.voiceRecordingBar.style.display = 'none';

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = (e) => {
          this.sendVoiceMessage(e.target.result, durationFormatted);
        };
        reader.readAsDataURL(audioBlob);
        this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
      };
      this.mediaRecorder.stop();
    } else {
      this.sendVoiceMessage(null, durationFormatted);
    }
  }

  sendVoiceMessage(audioDataUrl, duration) {
    const voiceMsg = {
      id: 'msg-voice-' + Date.now(),
      chatId: this.activeChatId,
      kind: 'voice',
      senderId: this.currentUser.id,
      senderName: this.currentUser.name,
      senderAvatar: this.currentUser.avatar,
      senderPhone: this.currentUser.phone,
      audio: audioDataUrl,
      duration: duration,
      timestamp: Date.now(),
      reactions: {},
      deliveredTo: [],
      readBy: []
    };

    this.broadcastAction({ type: 'MESSAGE_NEW', message: voiceMsg });
    this.playBeepSound('send');
    this.renderMessages();
    this.renderContactsList();
    this.scrollToBottom();
  }

  // --- Imágenes ---
  handleImageSelect(event) {
    const file = event.target.files[0];
    this.dom.attachmentMenu.style.display = 'none';
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      alert('La imagen no debe superar los 8MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      this.activeImageAttachment = e.target.result;
      this.dom.imagePreviewThumb.src = e.target.result;
      this.dom.previewFileName.textContent = file.name;
      this.dom.imagePreviewBar.style.display = 'flex';
      this.dom.messageInput.focus();
    };
    reader.readAsDataURL(file);
  }

  // --- Indicador de Escribiendo ---
  handleTyping() {
    this.broadcastTyping(true);
    clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      this.broadcastTyping(false);
    }, 1800);
  }

  broadcastTyping(isTyping) {
    if (!this.currentUser) return;
    const payload = {
      type: 'TYPING',
      chatId: this.activeChatId,
      userId: this.currentUser.id,
      userName: this.currentUser.name,
      isTyping
    };
    if (this.channel) this.channel.postMessage(payload);
    if (this.isServerConnected) {
      fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
    }
  }

  updateContactTyping(chatId, userName, isTyping) {
    if (chatId === this.activeChatId) {
      if (isTyping) {
        this.dom.partnerStatusText.style.display = 'none';
        this.dom.typingIndicatorHeader.style.display = 'inline-flex';
        this.dom.whoIsTypingText.textContent = `${userName} está escribiendo...`;
      } else {
        this.dom.partnerStatusText.style.display = 'inline';
        this.dom.typingIndicatorHeader.style.display = 'none';
      }
    }
    const item = document.querySelector(`.contact-item[data-chat-id="${chatId}"] .contact-preview`);
    if (item) {
      if (isTyping) {
        item.classList.add('contact-typing-text');
        item.textContent = 'escribiendo...';
      } else {
        item.classList.remove('contact-typing-text');
        this.renderContactsList(this.dom.searchInput.value.trim().toLowerCase());
      }
    }
  }

  // --- Abrir Chat ---
  openChat(chatId) {
    this.activeChatId = chatId;
    this.dom.appContainer.classList.add('chat-open');

    if (this.currentUser) {
      this.broadcastAction({ type: 'READ', chatId: this.activeChatId, userId: this.currentUser.id });
    }

    this.renderChatHeader();
    this.renderMessages();
    this.renderContactsList(this.dom.searchInput.value.trim().toLowerCase());
    this.scrollToBottom();
  }

  renderUserProfile() {
    if (!this.currentUser) return;
    this.dom.myUserName.textContent = this.currentUser.name;
    this.dom.myUserPhone.textContent = this.currentUser.phone || '+57 300 000 0000';
    this.dom.myAvatarImg.src = this.currentUser.avatar;
  }

  renderChatHeader() {
    if (this.activeChatId === this.shared.GENERAL_CHAT) {
      this.dom.chatPartnerName.textContent = 'Familia & Amigos (Grupo)';
      this.dom.chatPartnerPhone.style.display = 'none';
      this.dom.chatPartnerAvatar.src = 'https://api.dicebear.com/7.x/bottts/svg?seed=Grupo&backgroundColor=00a884,128c7e';
      this.dom.partnerStatusText.textContent = 'Grupo oficial de WhatsApp';
      this.dom.partnerStatusDot.style.display = 'none';
      return;
    }

    if (this.shared.isDM(this.activeChatId)) {
      const parts = this.shared.dmParticipants(this.activeChatId);
      const otherId = parts.find(id => id !== (this.currentUser ? this.currentUser.id : ''));
      const otherUser = this.state.users[otherId] || this.shared.DEFAULT_PROFILES.find(p => p.id === otherId) || {
        name: otherId,
        phone: otherId,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${otherId}`
      };

      this.dom.chatPartnerName.textContent = otherUser.name;
      if (otherUser.phone) {
        this.dom.chatPartnerPhone.textContent = otherUser.phone;
        this.dom.chatPartnerPhone.style.display = 'inline-block';
      } else {
        this.dom.chatPartnerPhone.style.display = 'none';
      }
      this.dom.chatPartnerAvatar.src = otherUser.avatar;
      this.dom.partnerStatusText.textContent = 'en línea';
      this.dom.partnerStatusDot.style.display = 'block';
    }
  }

  // --- Lista de Contactos & Conversaciones ---
  renderContactsList(filterQuery = '') {
    this.dom.contactsList.innerHTML = '';
    const conversations = [];

    // 1. Grupo General
    const generalMsgs = this.state.chats[this.shared.GENERAL_CHAT] || [];
    const lastGeneral = generalMsgs[generalMsgs.length - 1];
    const generalUnread = generalMsgs.filter(m => this.currentUser && m.senderId !== this.currentUser.id && (!m.readBy || !m.readBy.includes(this.currentUser.id))).length;

    conversations.push({
      chatId: this.shared.GENERAL_CHAT,
      name: 'Familia & Amigos (Grupo)',
      phone: 'Grupo oficial',
      avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Grupo&backgroundColor=00a884,128c7e',
      isGroup: true,
      lastMsg: lastGeneral,
      unread: generalUnread,
      hasStory: false
    });

    // 2. Todos los chats directos activos en el estado
    const profiles = this.shared.DEFAULT_PROFILES;
    const allUsers = { ...profiles.reduce((acc, p) => ({ ...acc, [p.id]: p }), {}), ...(this.state.users || {}) };

    Object.keys(this.state.chats).forEach(chatId => {
      if (chatId === this.shared.GENERAL_CHAT) return;
      if (this.currentUser && !this.shared.isParticipant(chatId, this.currentUser.id)) return;

      const parts = this.shared.dmParticipants(chatId);
      const otherId = parts.find(id => id !== (this.currentUser ? this.currentUser.id : ''));
      if (!otherId) return;

      const user = allUsers[otherId] || {
        id: otherId,
        name: otherId,
        phone: otherId,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${otherId}`
      };

      const msgs = this.state.chats[chatId] || [];
      const lastMsg = msgs[msgs.length - 1];
      const unreadCount = msgs.filter(m => this.currentUser && m.senderId !== this.currentUser.id && (!m.readBy || !m.readBy.includes(this.currentUser.id))).length;

      conversations.push({
        chatId: chatId,
        name: user.name,
        phone: user.phone || otherId,
        avatar: user.avatar,
        isGroup: false,
        lastMsg: lastMsg,
        unread: unreadCount,
        hasStory: !!user.hasStory,
        story: user.story
      });
    });

    // Añadir usuarios predeterminados si aún no tienen chat abierto con currentUser
    if (this.currentUser) {
      Object.keys(allUsers).forEach(id => {
        if (id === this.currentUser.id) return;
        const dmId = this.shared.dmChatId(this.currentUser.id, id);
        if (!conversations.some(c => c.chatId === dmId)) {
          const u = allUsers[id];
          conversations.push({
            chatId: dmId,
            name: u.name,
            phone: u.phone || id,
            avatar: u.avatar,
            isGroup: false,
            lastMsg: null,
            unread: 0,
            hasStory: !!u.hasStory,
            story: u.story
          });
        }
      });
    }

    // Filtrar por texto y tabs
    let filtered = conversations;
    if (this.activeFilter === 'unread') {
      filtered = filtered.filter(c => c.unread > 0);
    } else if (this.activeFilter === 'groups') {
      filtered = filtered.filter(c => c.isGroup);
    }

    if (filterQuery) {
      filtered = filtered.filter(c => 
        c.name.toLowerCase().includes(filterQuery) || 
        c.phone.toLowerCase().includes(filterQuery) || 
        (c.lastMsg && (c.lastMsg.text || '').toLowerCase().includes(filterQuery))
      );
    }

    // Renderizar
    filtered.forEach(chat => {
      const isCurrent = chat.chatId === this.activeChatId;
      const item = document.createElement('div');
      item.className = `contact-item ${isCurrent ? 'active' : ''} ${chat.unread > 0 ? 'unread' : ''}`;
      item.setAttribute('data-chat-id', chat.chatId);

      let lastSnippet = chat.phone ? `Número: ${chat.phone}` : 'Inicia una conversación';
      let checkIconHTML = '';

      if (chat.lastMsg) {
        if (chat.lastMsg.deleted) {
          lastSnippet = '🚫 Este mensaje fue eliminado';
        } else if (chat.lastMsg.kind === 'voice' || chat.lastMsg.isVoice) {
          lastSnippet = `🎙️ Nota de voz (${chat.lastMsg.duration || '0:03'})`;
        } else if (chat.lastMsg.kind === 'image' || chat.lastMsg.image) {
          lastSnippet = '📷 Foto';
        } else if (chat.lastMsg.text) {
          lastSnippet = chat.lastMsg.text;
        }

        if (this.currentUser && chat.lastMsg.senderId === this.currentUser.id) {
          const isRead = chat.lastMsg.readBy && chat.lastMsg.readBy.length > 0;
          checkIconHTML = `
            <span class="check-marks ${isRead ? 'read' : ''}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="18 6 9 17 4 12"></polyline>
                <polyline points="22 10 13 21 8 16"></polyline>
              </svg>
            </span>
          `;
        }
      }

      item.innerHTML = `
        <div class="contact-avatar ${chat.hasStory ? 'has-story-ring' : ''}">
          <img src="${chat.avatar}" alt="${chat.name}">
        </div>
        <div class="contact-body">
          <div class="contact-top">
            <span class="contact-name">${escapeHTML(chat.name)}</span>
            <span class="contact-time">${chat.lastMsg ? formatMsgTime(chat.lastMsg.timestamp) : ''}</span>
          </div>
          <div class="contact-bottom">
            <div class="contact-preview-wrap">
              ${checkIconHTML}
              <span class="contact-preview">${escapeHTML(lastSnippet)}</span>
            </div>
            ${chat.unread > 0 ? `<span class="contact-unread-badge">${chat.unread}</span>` : ''}
          </div>
        </div>
      `;

      item.addEventListener('click', () => {
        this.openChat(chat.chatId);
      });

      this.dom.contactsList.appendChild(item);
    });
  }

  // --- Renderizado de Mensajes ---
  renderMessages() {
    this.dom.messagesList.innerHTML = '';
    const messages = this.state.chats[this.activeChatId] || [];

    if (messages.length === 0) {
      this.dom.messagesList.innerHTML = `
        <div style="text-align: center; color: var(--text-faint); margin-top: 50px;">
          <p>No hay mensajes en este chat. ¡Envía el primero!</p>
        </div>
      `;
      return;
    }

    messages.forEach((msg) => {
      const isOutgoing = this.currentUser && msg.senderId === this.currentUser.id;
      const row = document.createElement('div');
      row.className = `message-row ${isOutgoing ? 'outgoing' : 'incoming'}`;
      row.id = msg.id;

      let replyHTML = '';
      if (msg.replyTo) {
        replyHTML = `
          <div class="reply-quote">
            <span class="reply-quote-sender">${escapeHTML(msg.replyTo.user)}</span>
            <span class="reply-quote-text">${escapeHTML(msg.replyTo.text)}</span>
          </div>
        `;
      }

      let contentHTML = '';
      if (msg.deleted) {
        contentHTML = `<div class="bubble-text" style="font-style: italic; opacity: 0.7;">🚫 Este mensaje fue eliminado</div>`;
      } else if (msg.kind === 'voice' || msg.isVoice) {
        contentHTML = `
          <div class="bubble-voice-msg" data-msg-id="${msg.id}">
            <button class="voice-play-btn" data-audio="${msg.audio || ''}">▶</button>
            <div class="voice-waveform-container">
              <div class="voice-waveform">
                <span class="waveform-bar"></span><span class="waveform-bar"></span>
                <span class="waveform-bar"></span><span class="waveform-bar"></span>
                <span class="waveform-bar"></span><span class="waveform-bar"></span>
                <span class="waveform-bar"></span><span class="waveform-bar"></span>
              </div>
              <div class="voice-meta-row">
                <span class="voice-time-label">${msg.duration || '0:03'}</span>
                <span class="voice-speed-badge">1x</span>
              </div>
            </div>
          </div>
        `;
      } else {
        if (msg.image) {
          contentHTML += `<img src="${msg.image}" class="bubble-media-img" alt="Foto adjunta" data-full="${msg.image}">`;
        }
        if (msg.text) {
          contentHTML += `<div class="bubble-text">${escapeHTML(msg.text)}</div>`;
        }
      }

      let checkHTML = '';
      if (isOutgoing) {
        const isRead = msg.readBy && msg.readBy.length > 0;
        checkHTML = `
          <span class="check-marks ${isRead ? 'read' : ''}" title="${isRead ? 'Leído' : 'Entregado'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="18 6 9 17 4 12"></polyline>
              <polyline points="22 10 13 21 8 16"></polyline>
            </svg>
          </span>
        `;
      }

      let reactionsHTML = '';
      if (msg.reactions && Object.keys(msg.reactions).length > 0) {
        reactionsHTML = '<div class="reactions-container">';
        const counts = {};
        Object.values(msg.reactions).forEach(e => { counts[e] = (counts[e] || 0) + 1; });
        for (const [emoji, c] of Object.entries(counts)) {
          reactionsHTML += `<span class="reaction-pill" data-msg-id="${msg.id}" data-emoji="${emoji}">${emoji} ${c > 1 ? c : ''}</span>`;
        }
        reactionsHTML += '</div>';
      }

      const isStarred = this.currentUser && msg.starredBy && msg.starredBy.includes(this.currentUser.id);
      const isEdited = !!msg.editedAt;

      row.innerHTML = `
        ${!isOutgoing && this.activeChatId === this.shared.GENERAL_CHAT ? `<img src="${msg.senderAvatar}" class="msg-sender-avatar" alt="${msg.senderName}">` : ''}
        <div class="message-bubble">
          <button class="bubble-actions-btn" data-msg-id="${msg.id}" title="Opciones del mensaje">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>

          ${!isOutgoing && this.activeChatId === this.shared.GENERAL_CHAT ? `<div class="bubble-sender">${escapeHTML(msg.senderName)}</div>` : ''}
          ${replyHTML}
          ${contentHTML}
          ${reactionsHTML}

          <div class="bubble-meta">
            ${isStarred ? '<span class="star-icon-pill" title="Mensaje destacado">★</span>' : ''}
            ${isEdited ? '<span class="edited-pill">(editado)</span>' : ''}
            <span>${formatMsgTime(msg.timestamp)}</span>
            ${checkHTML}
          </div>
        </div>
      `;

      const actionBtn = row.querySelector('.bubble-actions-btn');
      if (actionBtn) {
        actionBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openBubbleContextMenu(msg, actionBtn);
        });
      }

      const mediaImg = row.querySelector('.bubble-media-img');
      if (mediaImg) {
        mediaImg.addEventListener('click', () => {
          this.dom.lightboxImg.src = mediaImg.src;
          this.dom.lightboxCaption.textContent = msg.text || '';
          this.dom.imageLightboxModal.style.display = 'flex';
        });
      }

      const voicePlayBtn = row.querySelector('.voice-play-btn');
      if (voicePlayBtn) {
        voicePlayBtn.addEventListener('click', () => this.toggleVoicePlayback(msg, row));
      }

      row.querySelectorAll('.reaction-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          if (!this.currentUser) return;
          this.broadcastAction({
            type: 'REACT',
            chatId: this.activeChatId,
            id: msg.id,
            userId: this.currentUser.id,
            emoji: pill.getAttribute('data-emoji')
          });
          this.playBeepSound('send');
          this.renderMessages();
        });
      });

      this.dom.messagesList.appendChild(row);
    });
  }

  // --- Menú Contextual de Mensaje ---
  openBubbleContextMenu(msg, btnElement) {
    document.querySelectorAll('.bubble-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'bubble-context-menu';

    const quickBar = document.createElement('div');
    quickBar.className = 'reaction-quick-bar';
    ['❤️', '👍', '😂', '😮', '😢', '🙏'].forEach(em => {
      const b = document.createElement('button');
      b.className = 'quick-react-btn';
      b.textContent = em;
      b.addEventListener('click', () => {
        if (!this.currentUser) return;
        this.broadcastAction({
          type: 'REACT',
          chatId: this.activeChatId,
          id: msg.id,
          userId: this.currentUser.id,
          emoji: em
        });
        menu.remove();
        this.playBeepSound('send');
        this.renderMessages();
      });
      quickBar.appendChild(b);
    });
    menu.appendChild(quickBar);

    const isMe = this.currentUser && msg.senderId === this.currentUser.id;
    const isStarred = this.currentUser && msg.starredBy && msg.starredBy.includes(this.currentUser.id);

    const items = [
      {
        label: 'Responder',
        icon: '↩',
        action: () => {
          this.activeReply = {
            id: msg.id,
            user: msg.senderName,
            text: msg.text || (msg.kind === 'voice' ? 'Nota de voz' : 'Foto')
          };
          this.dom.replyToUser.textContent = msg.senderName;
          this.dom.replyToText.textContent = this.activeReply.text;
          this.dom.replyBar.style.display = 'flex';
          this.dom.messageInput.focus();
        }
      },
      {
        label: isStarred ? 'Quitar destacado' : 'Destacar',
        icon: '★',
        action: () => {
          if (!this.currentUser) return;
          this.broadcastAction({
            type: 'STAR_TOGGLE',
            chatId: this.activeChatId,
            id: msg.id,
            userId: this.currentUser.id
          });
          this.renderMessages();
        }
      },
      {
        label: 'Copiar texto',
        icon: '📋',
        action: () => {
          if (msg.text) {
            navigator.clipboard.writeText(msg.text);
            this.showToast('Mensaje copiado');
          }
        }
      }
    ];

    if (isMe && !msg.deleted) {
      items.push({
        label: 'Editar mensaje',
        icon: '✏️',
        action: () => {
          const newText = prompt('Editar mensaje:', msg.text);
          if (newText !== null && newText.trim() !== '') {
            this.broadcastAction({
              type: 'MESSAGE_EDIT',
              chatId: this.activeChatId,
              id: msg.id,
              userId: this.currentUser.id,
              text: newText.trim(),
              at: Date.now()
            });
            this.renderMessages();
          }
        }
      });
      items.push({
        label: 'Eliminar para todos',
        icon: '🗑',
        danger: true,
        action: () => {
          if (confirm('¿Eliminar este mensaje para todos?')) {
            this.broadcastAction({
              type: 'MESSAGE_DELETE',
              chatId: this.activeChatId,
              id: msg.id,
              userId: this.currentUser.id
            });
            this.renderMessages();
            this.renderContactsList();
          }
        }
      });
    }

    items.forEach(it => {
      const btn = document.createElement('button');
      btn.className = `menu-item ${it.danger ? 'danger' : ''}`;
      btn.innerHTML = `<span>${it.icon}</span> <span>${it.label}</span>`;
      btn.addEventListener('click', () => {
        menu.remove();
        it.action();
      });
      menu.appendChild(btn);
    });

    btnElement.parentElement.appendChild(menu);
  }

  // --- Reproductor de Notas de Voz ---
  toggleVoicePlayback(msg, rowElement) {
    const playBtn = rowElement.querySelector('.voice-play-btn');
    const container = rowElement.querySelector('.bubble-voice-msg');

    if (this.activeAudioPlayer) {
      this.activeAudioPlayer.pause();
      this.activeAudioPlayer = null;
      document.querySelectorAll('.bubble-voice-msg').forEach(b => b.classList.remove('playing'));
      document.querySelectorAll('.voice-play-btn').forEach(b => b.textContent = '▶');
    }

    if (msg.audio) {
      const audio = new Audio(msg.audio);
      this.activeAudioPlayer = audio;
      container.classList.add('playing');
      playBtn.textContent = '⏸';

      audio.onended = () => {
        container.classList.remove('playing');
        playBtn.textContent = '▶';
        this.activeAudioPlayer = null;
      };

      audio.play().catch(() => {});
    } else {
      container.classList.add('playing');
      playBtn.textContent = '⏸';
      this.playBeepSound('send');
      setTimeout(() => {
        container.classList.remove('playing');
        playBtn.textContent = '▶';
      }, 2500);
    }
  }

  // --- Estados / Historias ---
  openStoriesViewer() {
    const profilesWithStory = this.shared.DEFAULT_PROFILES.filter(p => p.hasStory);
    const storyUser = profilesWithStory[0] || this.shared.DEFAULT_PROFILES[0];

    this.dom.storyUserAvatar.src = storyUser.avatar;
    this.dom.storyUserName.textContent = storyUser.name;
    this.dom.storyTime.textContent = (storyUser.story && storyUser.story.time) || 'Hace 1 hora';
    this.dom.storyContentText.textContent = (storyUser.story && storyUser.story.text) || '¡Disfrutando de WhatsApp Web!';
    if (storyUser.story && storyUser.story.bg) {
      this.dom.storyBody.style.background = storyUser.story.bg;
    }

    this.dom.storiesModal.style.display = 'flex';
    this.dom.storyProgressFill.style.width = '0%';

    clearTimeout(this.storyTimer);
    setTimeout(() => {
      this.dom.storyProgressFill.style.transition = 'width 5s linear';
      this.dom.storyProgressFill.style.width = '100%';
    }, 50);

    this.storyTimer = setTimeout(() => {
      this.closeStoriesViewer();
    }, 5100);
  }

  closeStoriesViewer() {
    clearTimeout(this.storyTimer);
    this.dom.storiesModal.style.display = 'none';
  }

  // --- Llamadas Simuladas ---
  startSimulatedCall(type = 'audio') {
    let partner;
    if (this.shared.isDM(this.activeChatId)) {
      const parts = this.shared.dmParticipants(this.activeChatId);
      const otherId = parts.find(id => id !== (this.currentUser ? this.currentUser.id : ''));
      partner = this.state.users[otherId] || this.shared.DEFAULT_PROFILES.find(p => p.id === otherId);
    }
    if (!partner) partner = this.shared.DEFAULT_PROFILES[0];

    this.dom.callAvatarImg.src = partner.avatar;
    this.dom.callContactName.textContent = partner.name;
    this.dom.callStatusLabel.textContent = type === 'video' ? 'Videollamada de WhatsApp...' : 'Llamada de voz de WhatsApp...';
    this.dom.callTimerLabel.style.display = 'none';
    this.dom.callModal.style.display = 'flex';

    this.playBeepSound('ringtone');
    this.callInterval = setInterval(() => this.playBeepSound('ringtone'), 2500);

    this.callConnectTimeout = setTimeout(() => {
      clearInterval(this.callInterval);
      this.dom.callStatusLabel.textContent = 'Conectado';
      this.dom.callTimerLabel.style.display = 'block';
      this.callSeconds = 0;
      this.callTimer = setInterval(() => {
        this.callSeconds++;
        const mins = Math.floor(this.callSeconds / 60);
        const secs = this.callSeconds % 60;
        this.dom.callTimerLabel.textContent = `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
      }, 1000);
    }, 3200);
  }

  endSimulatedCall() {
    clearInterval(this.callInterval);
    clearInterval(this.callTimer);
    clearTimeout(this.callConnectTimeout);
    this.dom.callModal.style.display = 'none';
    this.showToast('Llamada finalizada');
  }

  // --- Modales Auxiliares ---
  openUserModal() {
    this.dom.userSelectGrid.innerHTML = '';
    const profiles = this.shared.DEFAULT_PROFILES;
    profiles.forEach(p => {
      const isCurrent = this.currentUser && p.id === this.currentUser.id;
      const card = document.createElement('div');
      card.className = `user-select-card ${isCurrent ? 'active' : ''}`;
      card.innerHTML = `
        <img src="${p.avatar}" alt="${p.name}">
        <div>
          <strong>${p.name} ${isCurrent ? '✓' : ''}</strong>
          <span style="font-size: 0.72rem; color: var(--accent-wa);">${p.phone}</span>
        </div>
      `;
      card.addEventListener('click', () => {
        this.setLoggedInUser(p);
        this.dom.switchUserModal.style.display = 'none';
      });
      this.dom.userSelectGrid.appendChild(card);
    });
    this.dom.switchUserModal.style.display = 'flex';
  }

  openNewChatModal() {
    this.dom.newChatContactsList.innerHTML = '';
    const profiles = this.shared.DEFAULT_PROFILES;
    profiles.forEach(p => {
      if (this.currentUser && p.id === this.currentUser.id) return;
      const item = document.createElement('div');
      item.className = 'contact-item';
      item.innerHTML = `
        <div class="contact-avatar"><img src="${p.avatar}" alt="${p.name}"></div>
        <div class="contact-body">
          <span class="contact-name">${p.name}</span>
          <span class="contact-preview">${p.phone}</span>
        </div>
      `;
      item.addEventListener('click', () => {
        const chatId = this.shared.dmChatId(this.currentUser.id, p.id);
        this.openChat(chatId);
        this.dom.newChatModal.style.display = 'none';
      });
      this.dom.newChatContactsList.appendChild(item);
    });
    this.dom.newChatModal.style.display = 'flex';
  }

  renderEmojiPicker() {
    this.dom.emojiGrid.innerHTML = '';
    EMOJIS.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = 'emoji-item';
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        this.dom.messageInput.value += emoji;
        this.dom.messageInput.focus();
      });
      this.dom.emojiGrid.appendChild(btn);
    });
  }

  scrollToBottom() {
    this.dom.messagesContainer.scrollTo({
      top: this.dom.messagesContainer.scrollHeight,
      behavior: 'smooth'
    });
  }

  showToast(text) {
    let toast = document.querySelector('.chat-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'chat-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.display = 'block';
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.style.display = 'none';
    }, 2800);
  }
}

function formatMsgTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  let hours = date.getHours();
  let minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;
  minutes = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minutes} ${ampm}`;
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

document.addEventListener('DOMContentLoaded', () => {
  window.whatsappApp = new WhatsAppWebApp();
});
