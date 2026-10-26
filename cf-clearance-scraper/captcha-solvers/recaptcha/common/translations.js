/**
 * reCAPTCHA translations and constants
 * Ported from the Python version
 */

// Audio challenge language codes
const ORIGINAL_LANGUAGE_AUDIO = {
  'en': 'en-US',
  'es': 'es-ES', 
  'fr': 'fr-FR',
  'de': 'de-DE',
  'pt': 'pt-BR',
  'ru': 'ru-RU',
  'it': 'it-IT',
  'nl': 'nl-NL',
  'pl': 'pl-PL'
};

// Common DOM element translations for different languages
const ELEMENT_TRANSLATIONS = {
  'audio_button': [
    'Get an audio challenge',
    'Obtener un desafío de audio',
    'Obtenir un défi audio',
    'Audio-Herausforderung erhalten',
    'Obter um desafio de áudio',
    'Получить звуковую задачу',
    'Ottieni una sfida audio',
    'Ontvang een audio-uitdaging',
    'Uzyskaj wyzwanie audio'
  ],
  'audio_response': [
    'Enter what you hear',
    'Introduce lo que escuchas',
    'Entrez ce que vous entendez',
    'Geben Sie ein, was Sie hören',
    'Digite o que você ouve',
    'Введите то, что слышите',
    'Inserisci quello che senti',
    'Voer in wat je hoort',
    'Wprowadź to, co słyszysz'
  ],
  'image_button': [
    'Get a visual challenge',
    'Obtener un desafío visual',
    'Obtenir un défi visuel',
    'Visuelle Herausforderung erhalten',
    'Obter um desafio visual',
    'Получить визуальную задачу',
    'Ottieni una sfida visiva',
    'Ontvang een visuele uitdaging',
    'Uzyskaj wyzwanie wizualne'
  ],
  'verify_button': [
    'Verify',
    'Verificar',
    'Vérifier',
    'Überprüfen',
    'Verificar',
    'Проверить',
    'Verifica',
    'Verifiëren',
    'Sprawdź'
  ],
  'reload_button': [
    'Get a new challenge',
    'Obtener un nuevo desafío',
    'Obtenir un nouveau défi',
    'Neue Herausforderung erhalten',
    'Obter um novo desafio',
    'Получить новую задачу',
    'Ottieni una nuova sfida',
    'Ontvang een nieuwe uitdaging',
    'Uzyskaj nowe wyzwanie'
  ]
};

// Object translations for image challenges
const OBJECT_TRANSLATIONS = {
  'car': ['car', 'cars', 'vehicle', 'vehicles'],
  'bicycle': ['bicycle', 'bicycles', 'bike', 'bikes'],
  'motorcycle': ['motorcycle', 'motorcycles', 'motorbike', 'motorbikes'],
  'bus': ['bus', 'buses'],
  'truck': ['truck', 'trucks'],
  'traffic_light': ['traffic light', 'traffic lights'],
  'fire_hydrant': ['fire hydrant', 'fire hydrants'],
  'stop_sign': ['stop sign', 'stop signs'],
  'crosswalk': ['crosswalk', 'crosswalks', 'pedestrian crossing'],
  'bridge': ['bridge', 'bridges'],
  'boat': ['boat', 'boats', 'ship', 'ships'],
  'train': ['train', 'trains'],
  'airplane': ['airplane', 'airplanes', 'plane', 'planes'],
  'taxi': ['taxi', 'taxis', 'cab', 'cabs'],
  'mountain': ['mountain', 'mountains', 'hill', 'hills'],
  'stairs': ['stairs', 'staircase', 'steps'],
  'chimney': ['chimney', 'chimneys'],
  'palm_tree': ['palm tree', 'palm trees'],
  'tree': ['tree', 'trees']
};

// Common reCAPTCHA challenge text patterns
const CHALLENGE_PATTERNS = {
  'select_all': [
    'Select all images with',
    'Click on all images containing',
    'Please select all images with',
    'Select all squares with'
  ],
  'click_verify': [
    'Please solve this challenge',
    'Please complete the security check',
    'Verify you are human'
  ]
};

// CSS selectors for reCAPTCHA elements
const SELECTORS = {
  // Main frames
  'anchor_frame': 'iframe[src*="recaptcha/api2/anchor"]',
  'bframe_frame': 'iframe[src*="recaptcha/api2/bframe"]',
  
  // Anchor frame elements
  'checkbox': '#recaptcha-anchor',
  'checkbox_spinner': '.recaptcha-checkbox-spinner',
  
  // Challenge frame elements
  'audio_button': '#recaptcha-audio-button',
  'image_button': '#recaptcha-image-button',
  'reload_button': '#recaptcha-reload-button',
  'verify_button': '#recaptcha-verify-button',
  'audio_source': '.rc-audiochallenge-tdownload-link',
  'audio_response': '#audio-response',
  'challenge_image': '.rc-image-tile-wrapper img',
  'challenge_title': '.rc-imageselect-desc-wrapper',
  'image_table': '.rc-imageselect-table',
  'image_tile': '.rc-imageselect-tile',
  'error_message': '.rc-audiochallenge-error-message, .rc-imageselect-error-select-more',
  
  // Response elements  
  'response_field': 'textarea[name="g-recaptcha-response"]',
  'token_textarea': '#g-recaptcha-response'
};

// Audio download patterns
const AUDIO_URL_PATTERNS = [
  /recaptcha\/api2\/payload\/audio\.php/,
  /recaptcha\/api2\/payload/,
  /google\.com.*audio/
];

module.exports = {
  ORIGINAL_LANGUAGE_AUDIO,
  ELEMENT_TRANSLATIONS,
  OBJECT_TRANSLATIONS,
  CHALLENGE_PATTERNS,
  SELECTORS,
  AUDIO_URL_PATTERNS
};