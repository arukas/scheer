/* global document, location, localStorage, navigator, setTimeout */

export const translations = {
  en: {
    homeMetaTitle: 'Scheer — Product data, straight to your backend',
    homeMetaDescription:
      'Scheer is a privacy-first Chrome extension that normalizes product data from multiple platforms and sends it to your backend.',
    privacyMetaTitle: 'Privacy Policy — Scheer',
    privacyMetaDescription:
      'Scheer Chrome extension privacy policy: no personal data collection, analytics, advertising, telemetry, or tracking.',
    skipLink: 'Skip to main content',
    mainNavigation: 'Main navigation',
    pageNavigation: 'Page navigation',
    homeLink: 'Scheer home',
    languageSelector: 'Language',
    navFeatures: 'Features',
    navPlatforms: 'Platforms',
    navApi: 'API docs',
    navPrivacy: 'Privacy',
    telegramGroup: 'Telegram group ↗',
    heroTitle: 'Product data, <span>straight</span> to your backend.',
    heroLead:
      'Scheer detects product pages in your browser, extracts data from multiple platforms, and normalizes it into one structure. One-click delivery with no third-party relay.',
    startApi: 'Integrate the API →',
    emailContact: 'Email us',
    emailContactArrow: 'Email us ↗',
    pipelineDiagram: 'Scheer data pipeline diagram',
    pipelineDetect: 'Detect product page',
    pipelineNormalize: 'Normalize fields',
    pipelineNormalizeDetail: 'Product · Variants · Options · Media',
    pipelineSend: 'Send to your backend',
    overview: 'Scheer overview',
    statPlatforms: 'collectable platforms',
    statEndpoints: 'backend endpoints',
    statRelays: 'relay servers',
    featuresTitle: 'Only what matters in the collection pipeline.',
    featuresLead:
      'Scheer keeps platform differences inside the extension, so your backend maintains one receiving flow. Credentials, history, and debug data stay on the device.',
    featureCollectTitle: 'Collect the current product',
    featureCollectText:
      'Scheer checks whether the current page is supported and only extracts and submits after user confirmation—no automatic pagination or bulk crawling.',
    featureSchemaTitle: 'One product schema',
    featureSchemaText:
      'Products, options, variants, prices, and media from different platforms map to stable JSON.',
    featureBackendTitle: 'Direct to your backend',
    featureBackendText:
      'You configure the destination, authentication header, and token. Data never passes through Scheer servers because there are none.',
    featureLogsTitle: 'Local history and redacted logs',
    featureLogsText:
      'Record creation results, enable Debug when needed, and export NDJSON logs with sensitive request headers redacted.',
    featureConfigTitle: 'Flexible endpoint settings',
    featureConfigText:
      'Use a base URL with relative paths or complete URLs, and customize authentication headers, prefixes, additional headers, and timeouts.',
    featurePrivacyTitle: 'Privacy first',
    featurePrivacyText:
      'The extension runs entirely in Chrome. Credentials stay in chrome.storage.local and account passwords are never uploaded.',
    platformsTitle: 'One entry point for major commerce platforms.',
    platformsLead:
      'Each collector handles its platform’s data source and page differences, then submits the same data model to your backend.',
    collectable: '● Collectable',
    detectOnly: '◐ Detection only',
    dataFlow: 'Data flow',
    flowInputTitle: 'Current product page',
    flowInputText: 'Opened and authorized by the user',
    flowScheerTitle: 'Platform detection and field conversion',
    flowScheerText: 'Completed entirely in the browser',
    flowOutputTitle: 'Your REST API',
    flowOutputText: 'Standard JSON sent directly over HTTPS',
    apiTitle: 'Your backend only needs two endpoints.',
    apiLead:
      'The default paths are <code>/scheer/products</code> and <code>/scheer/me</code>. Either can be replaced with a complete URL in the extension settings.',
    apiNavigation: 'API documentation',
    docsContents: 'Contents',
    auth: 'Authentication',
    createProduct: 'Create product',
    fieldSchema: 'Field schema',
    responseFormat: 'Response format',
    testConnection: 'Test connection',
    configExample: 'Configuration example',
    authText:
      'Bearer Token is used by default. The header name and prefix are configurable, and custom headers override defaults with the same name. Use HTTPS in production.',
    authNote:
      'The default request timeout is 30 seconds. The secret is stored only in the user’s local <code>chrome.storage.local</code>.',
    copy: 'Copy',
    copied: 'Copied',
    createProductText:
      'Receives the complete product data extracted from the current page and normalized by the extension.',
    schemaText:
      'Prices are sent as two-decimal strings to avoid floating-point errors. <code>variants</code> and <code>images</code> are always arrays.',
    field: 'Field',
    type: 'Type',
    requirement: 'Requirement',
    description: 'Description',
    required: 'Required',
    optional: 'Optional',
    platformCode: 'Platform code',
    sourceUrlDescription: 'Complete source product URL',
    sourceProductIdDescription: 'Original platform product ID',
    productTitleDescription: 'Product title',
    optionsDescription: 'Option dimensions, order, and values',
    variantsDescription: 'Variant list; prices are decimal strings',
    imagesDescription: 'Image or video list',
    platformCodesNote:
      'Platform codes: <code>shopify</code>, <code>newshop</code>, <code>shopbase</code>, <code>shopline</code>, <code>shoplazza</code>, <code>tiktok</code>, <code>amazon</code>, <code>wordpress</code>, and <code>shadowshop</code>. Legacy backends may map <code>newshop</code> to <code>wshop</code>.',
    responseText:
      'Return JSON for HTTP 2xx responses. <code>product_id</code> and <code>log_id</code> must be non-empty strings; the extension stores them in local history.',
    errorResponseText:
      'For HTTP 4xx / 5xx responses, return an error message that can be shown directly to the user:',
    testConnectionText:
      'The Settings page uses this endpoint to validate the URL, authentication, and JSON response.',
    testResponseText:
      'Return any valid JSON. The extension only checks for HTTP 2xx, a non-empty body, and valid JSON.',
    extensionConfigExample: 'Extension configuration example',
    configPasteText: 'The Settings page accepts JSON or the equivalent Base64-encoded JSON.',
    stepImplementTitle: 'Implement two endpoints',
    stepImplementText: 'Receive products and return creation results as described above.',
    stepConfigureTitle: 'Import and test settings',
    stepConfigureText: 'Save the token in Settings and select “Test configuration”.',
    stepOpenTitle: 'Open a product page',
    stepOpenText: 'Select the extension icon, confirm the platform, and create the product.',
    ctaTitle: 'Your product data should take the direct route.',
    ctaText: 'For extension, deployment, or API integration support, contact us by email.',
    footerSummary: '<a href="/privacy/">Privacy policy</a> · In-browser collection · Your backend',
    backHome: '← Back to home',
    privacyTitle: 'Privacy Policy',
    privacyLead:
      'Scheer is designed with privacy first. The project maintainers do not collect, store, sell, or share personal information, and do not track browsing or usage behavior.',
    effectiveDate: 'Effective date: July 23, 2026',
    privacySummaryTitle: 'In short',
    privacySummaryText:
      'Scheer has no data collection server, user accounts, analytics, advertising, or telemetry. Product data is sent only when the user acts and only to the backend they configured—not to Scheer maintainers.',
    notCollectTitle: 'What we do not collect',
    notCollectLead: 'Scheer maintainers do not collect the following through the extension:',
    notCollectIdentity:
      'Names, email addresses, phone numbers, account details, or other identity information;',
    notCollectBrowsing:
      'Browsing history, visited-site lists, search history, or time spent on pages;',
    notCollectCredentials: 'Authentication data, cookies, payment information, or form contents;',
    notCollectDevice: 'Device identifiers, IP addresses, location, or usage statistics.',
    unusedTechnologies: 'Technologies Scheer does not use',
    noAnalytics: 'No analytics',
    noAds: 'No ad SDKs',
    noTelemetry: 'No telemetry',
    noPixels: 'No tracking pixels',
    noFingerprinting: 'No fingerprinting',
    noBackgroundReports: 'No background reporting',
    productDataTitle: 'Product page data',
    productDataText1:
      'To collect product information, the extension identifies the current product page after receiving site access. It reads titles, prices, options, images, and other product information only when the user selects “Create product”.',
    productDataText2:
      'This data is transformed in the browser and sent directly to the backend configured in Scheer. Project maintainers do not receive, copy, or store it. The operator of the user’s backend is responsible for its processing.',
    localStorageTitle: 'Local storage',
    localStorageText1:
      'Backend URLs, access secrets, extension settings, creation history, and optional debug logs are stored in <code>chrome.storage.local</code> and used only for extension features.',
    localStorageText2:
      'This information is not sent automatically to Scheer maintainers. Users can disable log persistence, clear debug logs, or uninstall the extension to remove local data.',
    providedLogsTitle: 'Logs provided by users',
    providedLogsText1:
      'Users seeking technical support may choose to export and provide debug logs. This is voluntary; the extension never uploads logs automatically.',
    providedLogsText2:
      'We use voluntarily provided logs only to diagnose and resolve the reported issue—not for analytics, marketing, profiling, or any other purpose—and never sell or share them with third parties. Unneeded copies are deleted after the issue is resolved.',
    providedLogsText3:
      'Scheer redacts common sensitive request headers, but users should still review logs and remove information they do not want to provide.',
    thirdPartyTitle: 'Third-party services',
    thirdPartyText:
      'Scheer integrates no third-party analytics, advertising, or tracking services. It accesses only the product site opened by the user and the backend they configured; those services have their own privacy policies.',
    usageLimitsTitle: 'Data-use limits',
    usageLimitsText:
      'Web content and site permissions are used only for the user-requested product detection, collection, and submission features. Data is not used for advertising, credit assessment, resale, or unrelated purposes.',
    changesTitle: 'Changes to this policy',
    changesText:
      'If Scheer’s data practices change, this page and its effective date will be updated. Any new data collection will be clearly disclosed before implementation.',
    contactTitle: 'Contact us',
    contactText:
      'Questions about this policy can be sent to <a class="contact" href="mailto:developer@arukas.work">developer@arukas.work</a> or discussed with the maintainers in the <a class="contact" href="https://t.me/+wyVkA-3YU-kzZjMx" target="_blank" rel="noreferrer">Telegram group</a>.',
    privacyFooter: 'No collection · No tracking · No selling',
  },
  es: {
    homeMetaTitle: 'Scheer — Datos de producto directos a tu backend',
    homeMetaDescription:
      'Scheer es una extensión de Chrome centrada en la privacidad que normaliza datos de producto de varias plataformas y los envía a tu backend.',
    privacyMetaTitle: 'Política de privacidad — Scheer',
    privacyMetaDescription:
      'Política de privacidad de la extensión Scheer: sin recopilación de datos personales, analítica, publicidad, telemetría ni seguimiento.',
    skipLink: 'Saltar al contenido principal',
    mainNavigation: 'Navegación principal',
    pageNavigation: 'Navegación de la página',
    homeLink: 'Inicio de Scheer',
    languageSelector: 'Idioma',
    navFeatures: 'Funciones',
    navPlatforms: 'Plataformas',
    navApi: 'Documentación API',
    navPrivacy: 'Privacidad',
    telegramGroup: 'Grupo de Telegram ↗',
    heroTitle: 'Datos de producto, <span>directos</span> a tu backend.',
    heroLead:
      'Scheer detecta páginas de producto en el navegador, extrae datos de varias plataformas y los normaliza en una estructura única. Envío con un clic y sin intermediarios.',
    startApi: 'Integrar la API →',
    emailContact: 'Contacto por correo',
    emailContactArrow: 'Contacto por correo ↗',
    pipelineDiagram: 'Diagrama del flujo de datos de Scheer',
    pipelineDetect: 'Detectar página de producto',
    pipelineNormalize: 'Normalizar campos',
    pipelineNormalizeDetail: 'Producto · Variantes · Opciones · Medios',
    pipelineSend: 'Enviar a tu backend',
    overview: 'Resumen de Scheer',
    statPlatforms: 'plataformas compatibles',
    statEndpoints: 'endpoints de backend',
    statRelays: 'servidores intermediarios',
    featuresTitle: 'Solo lo importante del flujo de recopilación.',
    featuresLead:
      'Scheer mantiene las diferencias entre plataformas dentro de la extensión, para que tu backend use un único flujo. Las credenciales, el historial y la depuración permanecen en el dispositivo.',
    featureCollectTitle: 'Recopila el producto actual',
    featureCollectText:
      'Scheer comprueba si la página es compatible y solo extrae y envía después de la confirmación del usuario, sin paginación automática ni rastreo masivo.',
    featureSchemaTitle: 'Un único esquema de producto',
    featureSchemaText:
      'Productos, opciones, variantes, precios y medios de distintas plataformas se convierten en JSON estable.',
    featureBackendTitle: 'Directo a tu backend',
    featureBackendText:
      'Tú configuras el destino, la cabecera de autenticación y el token. Los datos no pasan por servidores de Scheer porque no existen.',
    featureLogsTitle: 'Historial local y registros protegidos',
    featureLogsText:
      'Guarda resultados, activa Debug cuando sea necesario y exporta registros NDJSON con las cabeceras sensibles ocultas.',
    featureConfigTitle: 'Configuración flexible',
    featureConfigText:
      'Usa una URL base con rutas relativas o URL completas y personaliza cabeceras, prefijos, cabeceras adicionales y tiempos de espera.',
    featurePrivacyTitle: 'Privacidad primero',
    featurePrivacyText:
      'La extensión se ejecuta por completo en Chrome. Las credenciales permanecen en chrome.storage.local y las contraseñas no se suben.',
    platformsTitle: 'Un punto de entrada para las principales plataformas.',
    platformsLead:
      'Cada recopilador resuelve las diferencias de su plataforma y envía el mismo modelo de datos a tu backend.',
    collectable: '● Compatible',
    detectOnly: '◐ Solo detección',
    dataFlow: 'Flujo de datos',
    flowInputTitle: 'Página de producto actual',
    flowInputText: 'Abierta y autorizada por el usuario',
    flowScheerTitle: 'Detección y conversión de campos',
    flowScheerText: 'Todo se completa en el navegador',
    flowOutputTitle: 'Tu API REST',
    flowOutputText: 'JSON estándar enviado directamente por HTTPS',
    apiTitle: 'Tu backend solo necesita dos endpoints.',
    apiLead:
      'Las rutas predeterminadas son <code>/scheer/products</code> y <code>/scheer/me</code>. Ambas pueden sustituirse por una URL completa en la configuración.',
    apiNavigation: 'Documentación de la API',
    docsContents: 'Contenido',
    auth: 'Autenticación',
    createProduct: 'Crear producto',
    fieldSchema: 'Estructura de campos',
    responseFormat: 'Formato de respuesta',
    testConnection: 'Probar conexión',
    configExample: 'Ejemplo de configuración',
    authText:
      'Se usa Bearer Token de forma predeterminada. El nombre y el prefijo de la cabecera son configurables, y las cabeceras personalizadas sustituyen a las predeterminadas con el mismo nombre. Usa HTTPS en producción.',
    authNote:
      'El tiempo de espera predeterminado es de 30 segundos. El secreto solo se guarda en <code>chrome.storage.local</code> del usuario.',
    copy: 'Copiar',
    copied: 'Copiado',
    createProductText:
      'Recibe todos los datos extraídos de la página actual y normalizados por la extensión.',
    schemaText:
      'Los precios se envían como cadenas con dos decimales para evitar errores de coma flotante. <code>variants</code> e <code>images</code> siempre son arrays.',
    field: 'Campo',
    type: 'Tipo',
    requirement: 'Requisito',
    description: 'Descripción',
    required: 'Obligatorio',
    optional: 'Opcional',
    platformCode: 'Código de plataforma',
    sourceUrlDescription: 'URL completa del producto original',
    sourceProductIdDescription: 'ID original del producto',
    productTitleDescription: 'Título del producto',
    optionsDescription: 'Dimensiones, orden y valores de opciones',
    variantsDescription: 'Lista de variantes; precios como cadenas decimales',
    imagesDescription: 'Lista de imágenes o vídeos',
    platformCodesNote:
      'Códigos de plataforma: <code>shopify</code>, <code>newshop</code>, <code>shopbase</code>, <code>shopline</code>, <code>shoplazza</code>, <code>tiktok</code>, <code>amazon</code>, <code>wordpress</code> y <code>shadowshop</code>. Los backends antiguos pueden asignar <code>newshop</code> a <code>wshop</code>.',
    responseText:
      'Devuelve JSON para respuestas HTTP 2xx. <code>product_id</code> y <code>log_id</code> deben ser cadenas no vacías; la extensión los guarda en el historial local.',
    errorResponseText:
      'Para respuestas HTTP 4xx / 5xx, devuelve un mensaje que pueda mostrarse directamente al usuario:',
    testConnectionText:
      'La página de configuración usa este endpoint para validar la URL, la autenticación y la respuesta JSON.',
    testResponseText:
      'Devuelve cualquier JSON válido. La extensión solo comprueba HTTP 2xx, un cuerpo no vacío y JSON válido.',
    extensionConfigExample: 'Ejemplo de configuración de la extensión',
    configPasteText:
      'La página de configuración acepta JSON o el JSON equivalente codificado en Base64.',
    stepImplementTitle: 'Implementa dos endpoints',
    stepImplementText: 'Recibe productos y devuelve el resultado como se describe arriba.',
    stepConfigureTitle: 'Importa y prueba la configuración',
    stepConfigureText: 'Guarda el token y selecciona “Probar configuración”.',
    stepOpenTitle: 'Abre una página de producto',
    stepOpenText: 'Selecciona el icono de la extensión, confirma la plataforma y crea el producto.',
    ctaTitle: 'Tus datos de producto deben ir por la ruta directa.',
    ctaText: 'Para soporte de la extensión, despliegue o integración API, contáctanos por correo.',
    footerSummary:
      '<a href="/privacy/">Política de privacidad</a> · Recopilación en el navegador · Tu backend',
    backHome: '← Volver al inicio',
    privacyTitle: 'Política de privacidad',
    privacyLead:
      'Scheer está diseñado con la privacidad como prioridad. Los responsables del proyecto no recopilan, almacenan, venden ni comparten información personal, ni rastrean la navegación o el uso.',
    effectiveDate: 'Fecha de entrada en vigor: 23 de julio de 2026',
    privacySummaryTitle: 'En resumen',
    privacySummaryText:
      'Scheer no tiene servidores de recopilación, cuentas de usuario, analítica, publicidad ni telemetría. Los datos del producto solo se envían cuando el usuario actúa y únicamente al backend configurado, nunca a los responsables de Scheer.',
    notCollectTitle: 'Qué no recopilamos',
    notCollectLead: 'Los responsables de Scheer no recopilan mediante la extensión:',
    notCollectIdentity:
      'Nombres, correos, teléfonos, datos de cuenta u otra información de identidad;',
    notCollectBrowsing:
      'Historial de navegación, sitios visitados, búsquedas o tiempo en las páginas;',
    notCollectCredentials:
      'Datos de autenticación, cookies, información de pago o contenido de formularios;',
    notCollectDevice: 'Identificadores del dispositivo, direcciones IP, ubicación o estadísticas.',
    unusedTechnologies: 'Tecnologías que Scheer no utiliza',
    noAnalytics: 'Sin analítica',
    noAds: 'Sin SDK publicitarios',
    noTelemetry: 'Sin telemetría',
    noPixels: 'Sin píxeles de seguimiento',
    noFingerprinting: 'Sin huellas digitales',
    noBackgroundReports: 'Sin informes en segundo plano',
    productDataTitle: 'Datos de la página de producto',
    productDataText1:
      'Para recopilar información, la extensión identifica la página actual tras recibir acceso al sitio. Solo lee títulos, precios, opciones, imágenes y otros datos cuando el usuario selecciona “Crear producto”.',
    productDataText2:
      'Los datos se transforman en el navegador y se envían directamente al backend configurado. Los responsables del proyecto no los reciben, copian ni guardan. El operador del backend del usuario es responsable de su tratamiento.',
    localStorageTitle: 'Almacenamiento local',
    localStorageText1:
      'Las URL del backend, los secretos, la configuración, el historial y los registros opcionales se guardan en <code>chrome.storage.local</code> y solo se usan para las funciones de la extensión.',
    localStorageText2:
      'Esta información no se envía automáticamente a los responsables de Scheer. El usuario puede desactivar los registros, borrarlos o desinstalar la extensión para eliminar los datos locales.',
    providedLogsTitle: 'Registros proporcionados por usuarios',
    providedLogsText1:
      'Quien solicite soporte puede exportar y proporcionar registros de depuración voluntariamente. La extensión nunca los sube automáticamente.',
    providedLogsText2:
      'Usamos los registros proporcionados solo para diagnosticar y resolver el problema comunicado, nunca para analítica, marketing, perfiles u otros fines, y no los vendemos ni compartimos. Las copias innecesarias se eliminan al resolver el problema.',
    providedLogsText3:
      'Scheer oculta cabeceras sensibles comunes, pero el usuario debe revisar los registros y retirar la información que no quiera proporcionar.',
    thirdPartyTitle: 'Servicios de terceros',
    thirdPartyText:
      'Scheer no integra analítica, publicidad ni seguimiento de terceros. Solo accede al sitio de producto abierto y al backend configurado; esos servicios tienen sus propias políticas de privacidad.',
    usageLimitsTitle: 'Límites de uso de datos',
    usageLimitsText:
      'El contenido web y los permisos se usan únicamente para detectar, recopilar y enviar productos a petición del usuario. Los datos no se usan para publicidad, evaluación crediticia, reventa ni fines ajenos.',
    changesTitle: 'Cambios en esta política',
    changesText:
      'Si cambian las prácticas de datos de Scheer, se actualizarán esta página y la fecha de entrada en vigor. Toda nueva recopilación se comunicará claramente antes de implementarse.',
    contactTitle: 'Contacto',
    contactText:
      'Las preguntas sobre esta política pueden enviarse a <a class="contact" href="mailto:developer@arukas.work">developer@arukas.work</a> o comentarse con los responsables en el <a class="contact" href="https://t.me/+wyVkA-3YU-kzZjMx" target="_blank" rel="noreferrer">grupo de Telegram</a>.',
    privacyFooter: 'Sin recopilación · Sin seguimiento · Sin venta',
  },
};

function normalizeLanguage(language) {
  const value = language?.toLowerCase() ?? '';
  if (value.startsWith('en')) return 'en';
  if (value.startsWith('es')) return 'es';
  return 'zh';
}

function init() {
  const elements = [...document.querySelectorAll('[data-i18n]')];
  const labels = [...document.querySelectorAll('[data-i18n-aria-label]')];
  const defaults = new Map(elements.map((element) => [element, element.innerHTML]));
  const defaultLabels = new Map(
    labels.map((element) => [element, element.getAttribute('aria-label')])
  );
  const defaultTitle = document.title;
  const description = document.querySelector('meta[name="description"]');
  const defaultDescription = description?.content ?? '';
  const page = location.pathname.startsWith('/privacy') ? 'privacy' : 'home';
  let currentLanguage = 'zh';

  function message(key) {
    return translations[currentLanguage]?.[key];
  }

  function applyLanguage(language) {
    currentLanguage = normalizeLanguage(language);
    const localized = translations[currentLanguage];

    document.documentElement.lang = currentLanguage === 'zh' ? 'zh-CN' : currentLanguage;
    document.title = localized?.[`${page}MetaTitle`] ?? defaultTitle;
    if (description) {
      description.content = localized?.[`${page}MetaDescription`] ?? defaultDescription;
    }

    elements.forEach((element) => {
      element.innerHTML = localized?.[element.dataset.i18n] ?? defaults.get(element);
    });
    labels.forEach((element) => {
      element.setAttribute(
        'aria-label',
        localized?.[element.dataset.i18nAriaLabel] ?? defaultLabels.get(element)
      );
    });
    document.querySelectorAll('[data-language]').forEach((select) => {
      select.value = currentLanguage;
    });

    try {
      localStorage.setItem('scheer-language', currentLanguage);
    } catch {
      // Language detection remains available when storage is blocked.
    }
  }

  let initialLanguage;
  try {
    initialLanguage = localStorage.getItem('scheer-language');
  } catch {
    // Fall back to the browser language.
  }
  applyLanguage(initialLanguage || navigator.language);

  document.querySelectorAll('[data-language]').forEach((select) => {
    select.addEventListener('change', (event) => applyLanguage(event.target.value));
  });
  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(button.nextElementSibling.innerText);
      button.textContent = message('copied') ?? '已复制';
      setTimeout(() => (button.textContent = message('copy') ?? '复制'), 1200);
    });
  });
}

if (typeof document !== 'undefined') init();
