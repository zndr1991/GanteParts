"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { MAX_ITEM_PHOTOS } from "@/lib/inventory-serialization";

type Item = {
  id: string;
  skuInternal: string;
  title: string | null;
  price: number | null;
  stock: number;
  mlItemId: string | null;
  status: string;
  sellerCustomField: string | null;
  extraData?: Record<string, any> | null;
  photoCount?: number;
  photoPreview?: string | null;
};

type FocusedInfo = {
  sku: string;
  coche: string;
  ano: string;
};

type NotificationItem = {
  id: string;
  message: string;
  createdAt: string;
  itemId?: string | null;
  status?: string | null;
  success: boolean;
  piece?: string | null;
  marca?: string | null;
  coche?: string | null;
  ano?: string | null;
  ubicacion?: string | null;
  skuInternal?: string | null;
  photoPreview?: string | null;
};

type NotificationViewerState = {
  src: string;
  title: string;
  subtitle?: string | null;
};

type InventoryEditFormState = {
  id: string;
  skuInternal: string;
  mlItemId: string;
  estatusInterno: string;
  stock: string;
  pieza: string;
  marca: string;
  coche: string;
  anoDesde: string;
  anoHasta: string;
  origen: string;
  price: string;
  precioCompra: string;
  ubicacion: string;
  prestadoVendidoA: string;
};

type SectionKey = "notifications" | "manual" | "import";

type InventoryFacetOptions = {
  marca: string[];
  coche: string[];
  pieza: string[];
  prestadoDebtor: string[];
};

type InventoryPageResponse = {
  items: Item[];
  page: number;
  pageSize: number;
  total: number;
  totalPages?: number;
  statusTotals?: Record<string, number>;
  facetOptions?: InventoryFacetOptions | null;
  prestadoMetrics?: {
    total: number;
    debt: number;
    profit: number;
  } | null;
};

type InventoryPageCachePayload = {
  items: Item[];
  total: number;
  statusTotals: Record<string, number>;
  prestadoMetrics: {
    total: number;
    debt: number;
    profit: number;
  } | null;
  hasFacetOptions: boolean;
  facetOptions: InventoryFacetOptions | null;
};

type ManualNomenclaturePieceEntry = {
  id: string;
  piece: string;
};

type ManualNomenclatureGroup = {
  id: string;
  prefix: string;
  pieces: ManualNomenclaturePieceEntry[];
};

type ManualNomenclaturesResponse = {
  items?: ManualNomenclatureGroup[];
};

type FinanceEntryType = "income" | "expense";

type SoldFinanceRegistrationResult =
  | { status: "skipped" }
  | { status: "registered"; entryType: FinanceEntryType }
  | { status: "failed"; message: string };

export type InventoryClientItem = Item;
export type InventoryInitialPage = InventoryPageResponse;

type InventoryClientProps = {
  initialPage: InventoryPageResponse;
  userRole: string;
  mode?: "full" | "manual-only";
};

type PhotoEditorTarget =
  | { type: "manual"; key: string }
  | { type: "modal"; index: number };

type PhotoEditorState = {
  title: string;
  dataUrl: string;
  target: PhotoEditorTarget;
};

type AnnotationTool = "brush" | "circle" | "arrow";

type SortKey = "estatusInterno" | "pieza" | "sku" | "status" | "marca" | "coche" | "ano" | "precio";

type InventorySearchIndexMessage = {
  type: "index";
  items: Item[];
};

type InventorySearchQueryMessage = {
  type: "search";
  query: string;
  requestId: number;
};

type InventorySearchWorkerResultMessage = {
  type: "search-result";
  query: string;
  requestId: number;
  ids: string[];
};

const brandOptions = [
  "ACURA",
  "AUDI",
  "BMW",
  "BUICK",
  "CADILLAC",
  "CHEVROLET",
  "CHRYSLER",
  "CITROEN",
  "DODGE",
  "FIAT",
  "FORD",
  "GMC",
  "HONDA",
  "HYUNDAI",
  "INFINITI",
  "JEEP",
  "KIA",
  "MAZDA",
  "MERCEDES BENZ",
  "MINI",
  "MITSUBISHI",
  "NISSAN",
  "PEUGEOT",
  "RAM",
  "RENAULT",
  "SEAT",
  "SUBARU",
  "SUZUKI",
  "TOYOTA",
  "VOLKSWAGEN",
  "VOLVO"
];

const deletePasswordSecret = (process.env.NEXT_PUBLIC_DELETE_PASSWORD ?? "").trim();

const MAX_PHOTOS = MAX_ITEM_PHOTOS;
const MAX_PHOTO_DIMENSION = 1280; // ancho/alto maximo al comprimir
const PHOTO_QUALITY = 0.8; // calidad JPEG al recomprimir
const drawingColors = ["#f87171", "#facc15", "#4ade80", "#38bdf8", "#f472b6", "#ffffff"];
const THUMBNAILS_ENABLED = true;
const NOTIFICATIONS_PAGE_SIZE = 10;
const NOTIFICATIONS_POLL_INTERVAL_MS = 20_000;
const TABLE_OVERSCAN_ROWS = 8;
const INVENTORY_TABLE_COLUMN_COUNT = 27;
const WORKER_SEARCH_MIN_ITEMS = 250;
const INVENTORY_PAGE_BLOCK_SIZE = 40;
const SERVER_SEARCH_DEBOUNCE_MS = 320;
const INVENTORY_PAGE_CACHE_TTL_MS = 25_000;
const INVENTORY_LOADING_INDICATOR_DELAY_MS = 180;
const MANUAL_SKU_NUMBER_PADDING = 5;

const makePhotoKey = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;

const normalizeStatusLabel = (value: unknown) => {
  const raw = (value ?? "").toString().trim().toUpperCase();
  return raw.length ? raw : "SIN ESTATUS";
};

const normalizeStatusTotals = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Record<string, number> = {};
  Object.entries(value as Record<string, unknown>).forEach(([label, count]) => {
    const normalizedLabel = normalizeStatusLabel(label);
    const parsedCount = Number(count);
    if (!Number.isFinite(parsedCount) || parsedCount <= 0) return;
    normalized[normalizedLabel] = Math.round(parsedCount);
  });
  return normalized;
};

const buildInventorySearchText = (item: Item) => {
  return [
    item.skuInternal,
    item.title ?? "",
    item.extraData?.descripcion_local ?? "",
    item.extraData?.descripcion_ml ?? "",
    item.mlItemId ?? "",
    item.sellerCustomField ?? "",
    item.extraData?.estatus_interno ?? "",
    item.extraData?.origen ?? "",
    item.extraData?.coche ?? "",
    item.extraData?.pieza ?? "",
    item.extraData?.marca ?? "",
    item.extraData?.ano_desde ?? "",
    item.extraData?.ano_hasta ?? "",
    item.extraData?.ubicacion ?? "",
    item.extraData?.inventario ?? "",
    item.extraData?.revision ?? "",
    item.extraData?.facebook ?? "",
    item.extraData?.prestado_vendido_a ?? "",
    item.extraData?.fecha_prestamo_pago ?? "",
    String(item.stock ?? ""),
    String(item.price ?? "")
  ]
    .join(" ")
    .toLowerCase();
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) || "");
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });

const normalizeDataUrlSize = (dataUrl: string) =>
  new Promise<string>((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        const maxDim = MAX_PHOTO_DIMENSION;
        const width = img.width || maxDim;
        const height = img.height || maxDim;
        const needsResize = width > maxDim || height > maxDim;
        const scale = needsResize ? Math.min(maxDim / width, maxDim / height) : 1;
        const targetWidth = Math.max(1, Math.round(width * scale));
        const targetHeight = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        resolve(canvas.toDataURL("image/jpeg", PHOTO_QUALITY));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch (err) {
      console.error("Error al normalizar la imagen", err);
      resolve(dataUrl);
    }
  });

const fileToDataUrl = async (file: File) => {
  const base64 = await readFileAsDataUrl(file);
  return normalizeDataUrlSize(base64);
};

const estatusInternoOptions = [
  "ML",
  "PRESTADO",
  "VENDIDO",
  "FOTOS",
  "FALTA UBICACION",
  "NO ESTA",
  "CHECAR",
  "SIN SUBIR"
];
const sortedEstatusInternoOptions = [...estatusInternoOptions].sort();

const origenOptions = [
  "NUEVO ORIGINAL",
  "NUEVO ORIGINAL CON DETALLE",
  "TW/GENERICO",
  "TW/GENERICO CON DETALLE",
  "USADO ORIGINAL SANO",
  "USADO ORIGINAL CON DETALLE"
];
const sortedOrigenOptions = [...origenOptions].sort();

const nuevoOriginalDescripcion =
  "PIEZA NUEVA ORIGINAL PUEDE QUE TENGA RASPONES DE ALMACENAMIENTO QUE NO AFECTAN EN NADA A SU FUNCIONAMIENTO.\n" +
  "SI NECESITA MAS FOTOS ENVIÉ MENSAJE ESTAREMOS AL PENDIENTE PARA RESPONDER LO MAS PRONTO POSIBLE .\n\n" +
  "SI FACTURAMOS, PRECIO YA INCLUYE IVA";

const nuevoOriginalDetalleDescripcion =
  "PIEZA ORIGINAL CON DAÑOS APRECIABLES EN FOTOS SI NECESITA MAS FOTOS ENVIÉ MENSAJE ESTAREMOS AL PENDIENTE PARA RESPONDER LO MAS PRONTO POSIBLE (NUEVO SE REFIERE A QUE NUNCA FUE INSTALADA) .  SI FACTURAMOS, PRECIO YA INCLUYE IVA";

const twGenericoDescripcion =
  "PIEZA NUEVA TW/GENERICA/NO ORIGINAL\nSI NECESITA MAS FOTOS ENVIÉ MENSAJE ESTAREMOS AL PENDIENTE PARA RESPONDER LO MAS PRONTO POSIBLE.  -SI FACTURAMOS, PRECIO YA INCLUYE IVA";

const twGenericoDetalleDescripcion =
  "PIEZA   TW/GENERICA/NO ORIGINAL CON DAÑOS APRECIABLES EN FOTOS\nSI NECESITA MAS FOTOS ENVIÉ MENSAJE ESTAREMOS AL PENDIENTE PARA RESPONDER LO MAS PRONTO POSIBLE . -SI FACTURAMOS, PRECIO YA INCLUYE IVA";

const usadoOriginalSanoDescripcion =
  "PIEZA USADA ORIGINAL EN BUENAS CONDICIONES\nSI NECESITA MAS FOTOS ENVIÉ MENSAJE ESTAREMOS AL PENDIENTE PARA RESPONDER LO MAS PRONTO POSIBLE.  - SI FACTURAMOS, PRECIO YA INCLUYE IVA";

const usadoOriginalDetalleDescripcion =
  "PIEZA CON DAÑOS APRECIABLES EN FOTOS SI NECESITA MAS FOTOS ENVIÉ MENSAJE ESTAREMOS AL PENDIENTE PARA RESPONDER LO MAS PRONTO POSIBLE.  -SI FACTURAMOS, PRECIO YA INCLUYE IVA";

const brandModels: Record<string, string[]> = {
  VOLKSWAGEN: ["BORA", "VENTO", "GOL", "JETTA", "POLO", "TIGUAN", "PASSAT", "SAVEIRO"],
  KIA: ["K3", "K4", "RIO", "SELTOS", "SPORTAGE", "SOUL", "SORENTO", "FORTE", "CERATO"],
  HYUNDAI: ["GRAND I10", "ELANTRA", "ACCENT", "CRETA", "TUCSON", "SANTA FE"],
  NISSAN: ["VERSA", "SENTRA", "MARCH", "FRONTIER", "XTRAIL"],
  TOYOTA: ["HILUX", "COROLLA", "CAMRY", "RAV4", "YARIS"],
  HONDA: ["CIVIC", "ACCORD", "CITY", "CRV", "HRV"],
  CHEVROLET: ["ONIX", "AVEO", "TRACKER", "CRUZE", "SILVERADO"],
  FORD: ["FIESTA", "FOCUS", "RANGER", "ESCAPE", "EXPLORER"],
  MAZDA: ["MAZDA 2", "MAZDA 3", "CX3", "CX5", "CX30"],
  BMW: ["SERIE 1", "SERIE 3", "SERIE 5", "X1", "X3"],
  "MERCEDES BENZ": ["A200", "C200", "GLA", "GLC", "GLE"],
  AUDI: ["A1", "A3", "A4", "Q2", "Q3"],
  RENAULT: ["KWID", "STEPWAY", "DUSTER", "LOGAN"],
  PEUGEOT: ["208", "2008", "301", "3008"],
  SUZUKI: ["SWIFT", "IGNIS", "VITARA", "BALENO"],
  SUBARU: ["IMPREZA", "FORESTER", "XV", "OUTBACK"],
  JEEP: ["RENEGADE", "COMPASS", "WRANGLER", "GLADIATOR"],
  RAM: ["1500", "700", "2500"],
  ACURA: ["ILX", "TLX", "RDX", "MDX"],
  INFINITI: ["Q30", "Q50", "QX50", "QX60"],
  VOLVO: ["XC40", "XC60", "XC90", "S60", "V60"],
  DODGE: ["ATTITUDE", "JOURNEY", "CHARGER"],
  FIAT: ["PULSE", "ARGO", "CRONOS"],
  CITROEN: ["C3", "C4 CACTUS", "C5 AIRCROSS"],
  SEAT: ["IBIZA", "LEON", "ARONA", "ATECA"],
  MITSUBISHI: ["L200", "OUTLANDER", "MIRAGE"],
  GMC: ["TERRAIN", "ACADIA", "SIERRA"],
  BUICK: ["ENCORE", "ENVISION", "ENCLAVE"],
  CADILLAC: ["XT4", "XT5", "ESCALADE"],
  CHRYSLER: ["PACIFICA", "300"],
  MINI: ["COOPER", "COUNTRYMAN", "CLUBMAN"]
};

const toUpper = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
};

const sanitizePhotos = (value: any) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length)
    .slice(0, MAX_PHOTOS);
};

const toFocusedInfo = (item?: Item | null): FocusedInfo | null => {
  if (!item) return null;
  const extra = item.extraData ?? {};
  const hasYear = extra.ano_desde || extra.ano_hasta;
  const ano = hasYear ? `${extra.ano_desde ?? "-"}-${extra.ano_hasta ?? "-"}` : "-";
  const sku = (item.skuInternal ?? "").toString().trim();
  const cocheRaw = (extra.coche ?? "").toString().trim();
  return {
    sku: sku.length ? sku.toUpperCase() : "-",
    coche: cocheRaw.length ? cocheRaw.toUpperCase() : "-",
    ano
  };
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const dd = String(parsed.getDate()).padStart(2, "0");
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const yyyy = parsed.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  const match = value.replace(/\./g, "/").match(/(\d{1,4})[\/](\d{1,2})[\/](\d{1,4})/);
  if (match) {
    const first = match[1];
    const second = match[2];
    const third = match[3];
    const yearFirst = first.length === 4;
    const day = yearFirst ? third : first;
    const month = second;
    const year = yearFirst ? first : third;
    return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year.padStart(4, "0")}`;
  }
  return value;
};

const formatCurrencyMx = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 2
    }).format(Number(value));
  } catch {
    return value?.toString() ?? "-";
  }
};

const parseCurrencyLikeNumber = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const raw = value.toString().trim();
  if (!raw.length) return null;
  const normalized = raw.replace(/,/g, "").replace(/[^0-9.-]/g, "");
  if (!normalized.length) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const roundCurrencyValue = (value: number) => Math.round(value * 100) / 100;

const normalizeFacetOptionList = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => (entry ?? "").toString().trim().toUpperCase())
        .filter((entry) => entry.length)
    )
  ).sort((a, b) => a.localeCompare(b, "es"));
};

const normalizeFacetOptions = (value: unknown): InventoryFacetOptions => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      marca: [],
      coche: [],
      pieza: [],
      prestadoDebtor: []
    };
  }

  const source = value as Record<string, unknown>;
  return {
    marca: normalizeFacetOptionList(source.marca),
    coche: normalizeFacetOptionList(source.coche),
    pieza: normalizeFacetOptionList(source.pieza),
    prestadoDebtor: normalizeFacetOptionList(source.prestadoDebtor)
  };
};

const buildInventoryPageCacheKey = (options: {
  page: number;
  search: string;
  statusFilter: string | null;
  marcaFilter: string;
  cocheFilter: string;
  piezaFilter: string;
  prestadoDebtorFilters: string[];
  includeFacetOptions: boolean;
}) => {
  const normalizedDebtors = Array.from(
    new Set(
      options.prestadoDebtorFilters
        .map((value) => value.trim().toUpperCase())
        .filter((value) => value.length)
    )
  ).sort((a, b) => a.localeCompare(b, "es"));

  return JSON.stringify({
    page: Math.max(1, options.page),
    search: options.search.trim(),
    statusFilter: options.statusFilter?.trim().toUpperCase() || null,
    marcaFilter: options.marcaFilter.trim().toUpperCase(),
    cocheFilter: options.cocheFilter.trim().toUpperCase(),
    piezaFilter: options.piezaFilter.trim().toUpperCase(),
    prestadoDebtorFilters: normalizedDebtors,
    includeFacetOptions: options.includeFacetOptions
  });
};

const normalizeManualNomenclaturePiece = (value: string) =>
  value.toUpperCase().trim().replace(/\s+/g, " ");

const normalizeManualNomenclaturePrefix = (value: string) =>
  value.toUpperCase().trim().replace(/[^A-Z0-9]/g, "");

const formatSkuFromPrefixNumber = (prefix: string, number: number) => {
  const safe = Number.isFinite(number) && number > 0 ? Math.trunc(number) : 1;
  return `${prefix}-${String(safe).padStart(MANUAL_SKU_NUMBER_PADDING, "0")}`;
};

const parseSkuSuffixNumber = (sku: string, prefix: string) => {
  const match = sku.toUpperCase().match(new RegExp(`^${prefix}-([0-9]+)$`));
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const normalizePrestadoMetrics = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const source = value as Record<string, unknown>;
  const total = Number(source.total ?? NaN);
  const debt = Number(source.debt ?? NaN);
  const profit = Number(source.profit ?? NaN);

  if (!Number.isFinite(total) || !Number.isFinite(debt) || !Number.isFinite(profit)) {
    return null;
  }

  return {
    total: roundCurrencyValue(total),
    debt: roundCurrencyValue(debt),
    profit: roundCurrencyValue(profit)
  };
};

const todayDateOnly = () => new Date().toISOString().slice(0, 10);

const toDateOnly = (value?: string | null) => {
  const raw = (value ?? "").toString().trim();
  if (!raw.length) return todayDateOnly();
  return raw.slice(0, 10);
};

const parsePositiveAmountInput = (rawValue: string) => {
  const normalized = rawValue.replace(/[^0-9.-]/g, "").trim();
  if (!normalized.length) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
};

const formatRelativeTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  const diffMs = Date.now() - parsed.getTime();
  if (diffMs < 45_000) return "Hace unos segundos";
  if (diffMs < 90_000) return "Hace un minuto";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `Hace ${days} d`;
};

const buildNotificationActionKey = (entry: NotificationItem) => {
  const itemId = (entry.itemId ?? "").toString().trim().toUpperCase();
  const status = (entry.status ?? "").toString().trim().toLowerCase();
  const success = entry.success ? "1" : "0";
  return [itemId, status, success].join("||");
};

const dedupeNotificationsByAction = (entries: NotificationItem[]) => {
  const seen = new Set<string>();
  const result: NotificationItem[] = [];
  entries.forEach((entry) => {
    const key = buildNotificationActionKey(entry);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(entry);
  });
  return result;
};

const normalizeFacetValue = (value: unknown) => (value ?? "").toString().trim().toUpperCase();

const getStatusBadgeClass = (status?: string | null) => {
  switch ((status ?? "").toLowerCase()) {
    case "active":
      return "border-emerald-400/50 bg-emerald-500/20 text-emerald-100";
    case "paused":
      return "border-amber-400/50 bg-amber-500/20 text-amber-100";
    case "inactive":
      return "border-rose-400/50 bg-rose-500/20 text-rose-100";
    default:
      return "border-slate-600 bg-slate-800/60 text-slate-200";
  }
};

export function InventoryClient({ initialPage, userRole, mode = "full" }: InventoryClientProps) {
  const isManualOnly = mode === "manual-only";
  const [manualTab, setManualTab] = useState<"capture" | "nomenclatures">("capture");
  const [items, setItems] = useState<Item[]>(initialPage.items);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [focusedRowInfo, setFocusedRowInfo] = useState<FocusedInfo | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [inventoryMarcaFilter, setInventoryMarcaFilter] = useState("");
  const [inventoryCocheFilter, setInventoryCocheFilter] = useState("");
  const [inventoryPiezaFilter, setInventoryPiezaFilter] = useState("");
  const [prestadoDebtorFilters, setPrestadoDebtorFilters] = useState<string[]>([]);
  const [form, setForm] = useState({
    skuInternal: "",
    mlItemId: "",
    estatusInterno: "",
    stock: "",
    pieza: "",
    marca: "",
    coche: "",
    anoDesde: "",
    anoHasta: "",
    origen: "",
    price: "",
    precioCompra: "",
    ubicacion: ""
  });
  const [manualNomenclatureGroups, setManualNomenclatureGroups] = useState<ManualNomenclatureGroup[]>([]);
  const [manualNomenclaturePrefixDraft, setManualNomenclaturePrefixDraft] = useState("");
  const [manualNomenclaturePieceDraft, setManualNomenclaturePieceDraft] = useState("");
  const [manualNomenclatureSelectedId, setManualNomenclatureSelectedId] = useState("");
  const [manualNomenclatureLoading, setManualNomenclatureLoading] = useState(false);
  const [manualNomenclatureError, setManualNomenclatureError] = useState<string | null>(null);
  const [manualSkuSuggestion, setManualSkuSuggestion] = useState<string>("");
  const [manualSkuSuggestionPrefix, setManualSkuSuggestionPrefix] = useState<string | null>(null);
  const [manualSkuSuggestionLoading, setManualSkuSuggestionLoading] = useState(false);
  const [manualSkuSuggestionError, setManualSkuSuggestionError] = useState<string | null>(null);
  const [manualSkuEdited, setManualSkuEdited] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsLoadingMore, setNotificationsLoadingMore] = useState(false);
  const [notificationsPage, setNotificationsPage] = useState(1);
  const [notificationsHasMore, setNotificationsHasMore] = useState(false);
  const [notificationsSearch, setNotificationsSearch] = useState("");
  const [toastNotification, setToastNotification] = useState<NotificationItem | null>(null);
  const [notificationViewer, setNotificationViewer] = useState<NotificationViewerState | null>(null);
  const [updatingIds, setUpdatingIds] = useState<string[]>([]);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const modalPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const editorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const photoEditorBaseRef = useRef<string | null>(null);
  const shapeSnapshotRef = useRef<HTMLCanvasElement | null>(null);
  const shapeStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [editedPhotos, setEditedPhotos] = useState<Record<string, string>>({});
  const [manualPhotoPreviewUrls, setManualPhotoPreviewUrls] = useState<Record<string, string>>({});
  const manualPhotoPreviewUrlsRef = useRef<Record<string, string>>({});
  const [photoEditor, setPhotoEditor] = useState<PhotoEditorState | null>(null);
  const [photoEditorBusy, setPhotoEditorBusy] = useState(false);
  const [photoEditorReady, setPhotoEditorReady] = useState(false);
  const [photoEditorError, setPhotoEditorError] = useState<string | null>(null);
  const [photoEditorSaving, setPhotoEditorSaving] = useState(false);
  const [drawingMode, setDrawingMode] = useState(false);
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>("brush");
  const [isDrawingStroke, setIsDrawingStroke] = useState(false);
  const [drawingColor, setDrawingColor] = useState(drawingColors[0]);
  const [brushSize, setBrushSize] = useState(4);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [photoModal, setPhotoModal] = useState<{ id: string; title: string } | null>(null);
  const [modalPhotos, setModalPhotos] = useState<string[]>([]);
  const [photoModalSaving, setPhotoModalSaving] = useState(false);
  const [editingRowId] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{
    key: SortKey;
    direction: "asc" | "desc";
  } | null>(null);
  const [photoModalError, setPhotoModalError] = useState<string | null>(null);
  const [photoModalLoading, setPhotoModalLoading] = useState(false);
  const [modalActiveIndex, setModalActiveIndex] = useState(0);
  const [inventoryEditForm, setInventoryEditForm] = useState<InventoryEditFormState | null>(null);
  const [inventoryEditError, setInventoryEditError] = useState<string | null>(null);
  const [inventoryEditSaving, setInventoryEditSaving] = useState(false);
  const [thumbnailVersionById, setThumbnailVersionById] = useState<Record<string, number>>({});
  const [mlAction, setMlAction] = useState<null | "pause" | "activate">(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastNotificationIdRef = useRef<string | null>(null);
  const searchWorkerRef = useRef<Worker | null>(null);
  const workerSearchRequestIdRef = useRef(0);
  const inventoryPageRequestIdRef = useRef(0);
  const inventoryRequestAbortRef = useRef<AbortController | null>(null);
  const loadingPageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inventoryPageCacheRef = useRef<Map<string, { expiresAt: number; payload: InventoryPageCachePayload }>>(
    new Map()
  );
  const manualSkuSequenceCacheRef = useRef(new Map<string, number>());
  const manualSkuRequestAbortRef = useRef<AbortController | null>(null);
  const lastManualSuggestionPrefixRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const desktopTableContainerRef = useRef<HTMLDivElement | null>(null);
  const localEstatusInternoRef = useRef(
    new Map<string, { value: string; updatedAt: number; prestadoVendidoA?: string | null }>()
  );
  const [isMobile, setIsMobile] = useState(false);
  const [totalItems, setTotalItems] = useState(initialPage.total);
  const [statusTotals, setStatusTotals] = useState<Record<string, number>>(
    normalizeStatusTotals(initialPage.statusTotals)
  );
  const [prestadoMetrics, setPrestadoMetrics] = useState<{
    total: number;
    debt: number;
    profit: number;
  } | null>(normalizePrestadoMetrics(initialPage.prestadoMetrics));
  const [serverFacetOptions, setServerFacetOptions] = useState<InventoryFacetOptions>(
    normalizeFacetOptions(initialPage.facetOptions)
  );
  const [workerSearchResult, setWorkerSearchResult] = useState<{ query: string; ids: string[] } | null>(null);
  const [workerSearching, setWorkerSearching] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventoryReloadSeq, setInventoryReloadSeq] = useState(0);
  const [debouncedServerSearchTerm, setDebouncedServerSearchTerm] = useState("");
  const [tableScrollRowStart, setTableScrollRowStart] = useState(0);
  const [sectionVisibility, setSectionVisibility] = useState<Record<SectionKey, boolean>>({
    notifications: false,
    manual: true,
    import: true
  });
  const tableVisibleRows = 10;
  const tableRowHeight = 56;
  const tableHeaderHeight = 44;
  const tableViewportHeight = tableVisibleRows * tableRowHeight;
  const normalizedRole = (userRole ?? "operator").toLowerCase();
  const canEditInventory = normalizedRole === "admin" || normalizedRole === "supervisor";
  const canCreateManual = canEditInventory || normalizedRole === "operator" || normalizedRole === "uploader";
  const canImportInventory = canEditInventory;
  const canManageMercadoLibre = canEditInventory;
  const thumbnailsActive = THUMBNAILS_ENABLED;
  const useServerPagination = !isManualOnly;

  useEffect(() => {
    const handleResize = () => {
      if (typeof window === "undefined") return;
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (isManualOnly) {
      setSectionVisibility({ notifications: false, manual: true, import: false });
      return;
    }
    if (isMobile) {
      setSectionVisibility({ notifications: false, manual: true, import: false });
    } else {
      setSectionVisibility({ notifications: false, manual: true, import: true });
    }
  }, [isManualOnly, isMobile]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof Worker === "undefined") {
      return;
    }

    let mounted = true;
    let worker: Worker;

    try {
      worker = new Worker(new URL("../../workers/inventory-search.worker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      console.error("No se pudo iniciar el worker de busqueda de inventario", error);
      return;
    }

    searchWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<InventorySearchWorkerResultMessage>) => {
      if (!mounted) return;
      const payload = event.data;
      if (!payload || payload.type !== "search-result") return;
      if (payload.requestId !== workerSearchRequestIdRef.current) return;
      setWorkerSearchResult({ query: payload.query, ids: payload.ids });
      setWorkerSearching(false);
    };

    worker.onerror = (error) => {
      console.error("Worker de busqueda de inventario fallo", error);
      if (mounted) {
        setWorkerSearching(false);
      }
    };

    return () => {
      mounted = false;
      if (searchWorkerRef.current === worker) {
        searchWorkerRef.current = null;
      }
      worker.terminate();
    };
  }, []);

  const toggleSection = useCallback((section: SectionKey) => {
    if (isManualOnly) return;
    if (section !== "notifications" && !isMobile) return;
    setSectionVisibility((prev) => ({ ...prev, [section]: !prev[section] }));
  }, [isManualOnly, isMobile]);

  const triggerNotificationToast = useCallback((entry: NotificationItem) => {
    setToastNotification(entry);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => {
      setToastNotification(null);
      toastTimeoutRef.current = null;
    }, 6000);
  }, []);

  const fetchNotifications = useCallback(async (options?: { silent?: boolean; search?: string; page?: number; append?: boolean }) => {
    const silent = Boolean(options?.silent);
    const append = Boolean(options?.append);
    const targetPage = Math.max(1, options?.page ?? 1);
    const useOverrideSearch = Boolean(options && Object.prototype.hasOwnProperty.call(options, "search"));
    const searchTerm = (useOverrideSearch ? options?.search ?? "" : notificationsSearch).trim();
    if (!silent && isMountedRef.current) {
      if (append) {
        setNotificationsLoadingMore(true);
      } else {
        setNotificationsLoading(true);
      }
    }
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        pageSize: String(NOTIFICATIONS_PAGE_SIZE)
      });
      if (searchTerm.length) {
        params.set("search", searchTerm);
      }

      const res = await fetch(`/api/notifications?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error("No se pudieron obtener las notificaciones");
      }
      const data = await res.json().catch(() => ({}));
      const list: NotificationItem[] = Array.isArray(data.notifications) ? data.notifications : [];
      const uniqueList = dedupeNotificationsByAction(list);
      const serverPage = Math.max(1, Number(data.page ?? targetPage));
      const hasMore = Boolean(data.hasMore ?? list.length === NOTIFICATIONS_PAGE_SIZE);
      if (!isMountedRef.current) return;
      if (append) {
        setNotifications((prev) => {
          return dedupeNotificationsByAction([...prev, ...uniqueList]);
        });
      } else {
        setNotifications(uniqueList);
      }
      setNotificationsPage(serverPage);
      setNotificationsHasMore(hasMore);

      if (!append && !searchTerm.length && uniqueList.length) {
        const newest = uniqueList[0];
        if (!lastNotificationIdRef.current) {
          lastNotificationIdRef.current = newest.id;
          return;
        }
        if (lastNotificationIdRef.current !== newest.id) {
          lastNotificationIdRef.current = newest.id;
          triggerNotificationToast(newest);
        }
      }
    } catch (err: any) {
      if (!silent && isMountedRef.current) {
        setMessage(err?.message || "No se pudieron obtener las notificaciones");
      }
    } finally {
      if (!silent && isMountedRef.current) {
        if (append) {
          setNotificationsLoadingMore(false);
        } else {
          setNotificationsLoading(false);
        }
      }
    }
  }, [notificationsSearch, triggerNotificationToast]);

  const handleNotificationsSearchSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void fetchNotifications({ silent: false });
    },
    [fetchNotifications]
  );

  const clearNotificationsSearch = useCallback(() => {
    setNotificationsSearch("");
    void fetchNotifications({ silent: false, search: "", page: 1 });
  }, [fetchNotifications]);

  const loadMoreNotifications = useCallback(() => {
    if (notificationsLoading || notificationsLoadingMore || !notificationsHasMore) return;
    void fetchNotifications({
      silent: false,
      search: notificationsSearch,
      page: notificationsPage + 1,
      append: true
    });
  }, [fetchNotifications, notificationsHasMore, notificationsLoading, notificationsLoadingMore, notificationsPage, notificationsSearch]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      if (loadingPageTimeoutRef.current) {
        clearTimeout(loadingPageTimeoutRef.current);
        loadingPageTimeoutRef.current = null;
      }
      if (inventoryRequestAbortRef.current) {
        inventoryRequestAbortRef.current.abort();
        inventoryRequestAbortRef.current = null;
      }
      if (manualSkuRequestAbortRef.current) {
        manualSkuRequestAbortRef.current.abort();
        manualSkuRequestAbortRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!notificationViewer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotificationViewer(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [notificationViewer]);

  useEffect(() => {
    if (isManualOnly) {
      return undefined;
    }
    if (notificationsSearch.trim().length || notificationsPage > 1) {
      return undefined;
    }
    fetchNotifications({ silent: true, search: "", page: 1 });
    const interval = setInterval(() => fetchNotifications({ silent: true, search: "", page: 1 }), NOTIFICATIONS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchNotifications, isManualOnly, notificationsPage, notificationsSearch]);

  const downloadTemplate = async () => {
    setDownloading(true);
    try {
      const res = await fetch("/api/inventory/template");
      if (!res.ok) throw new Error("No se pudo descargar la plantilla");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "plantilla-inventario.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setMessage(err.message || "No se pudo descargar");
    } finally {
      setDownloading(false);
    }
  };

  const mergeIncomingWithLocalOverrides = useCallback((incoming: Item[]) => {
    const now = Date.now();
    return incoming.map((item) => {
      const local = localEstatusInternoRef.current.get(item.id);
      if (!local) return item;
      if (now - local.updatedAt > 10 * 60 * 1000) {
        localEstatusInternoRef.current.delete(item.id);
        return item;
      }
      const currentInternal = (item.extraData?.estatus_interno ?? "").toString().trim().toUpperCase();
      if (currentInternal === local.value) {
        localEstatusInternoRef.current.delete(item.id);
        return item;
      }
      const nextExtra: Record<string, any> = {
        ...(item.extraData ?? {}),
        estatus_interno: local.value || undefined
      };
      if (local.prestadoVendidoA !== undefined) {
        nextExtra.prestado_vendido_a = local.prestadoVendidoA || undefined;
      }
      return { ...item, extraData: nextExtra };
    });
  }, []);

  const fetchInventoryPage = useCallback(async (options: {
    page: number;
    search: string;
    statusFilter: string | null;
    marcaFilter: string;
    cocheFilter: string;
    piezaFilter: string;
    prestadoDebtorFilters: string[];
    includeFacetOptions?: boolean;
    preserveSelection?: boolean;
  }) => {
    const requestId = inventoryPageRequestIdRef.current + 1;
    inventoryPageRequestIdRef.current = requestId;

    if (inventoryRequestAbortRef.current) {
      inventoryRequestAbortRef.current.abort();
      inventoryRequestAbortRef.current = null;
    }
    if (loadingPageTimeoutRef.current) {
      clearTimeout(loadingPageTimeoutRef.current);
      loadingPageTimeoutRef.current = null;
    }

    setMessage(null);
    setLoadingPage(false);

    const includeFacetOptions = Boolean(options.includeFacetOptions);
    const cacheKey = buildInventoryPageCacheKey({
      page: options.page,
      search: options.search,
      statusFilter: options.statusFilter,
      marcaFilter: options.marcaFilter,
      cocheFilter: options.cocheFilter,
      piezaFilter: options.piezaFilter,
      prestadoDebtorFilters: options.prestadoDebtorFilters,
      includeFacetOptions
    });

    const cached = inventoryPageCacheRef.current.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      const incomingWithLocal = mergeIncomingWithLocalOverrides(cached.payload.items);
      setItems(incomingWithLocal);
      setTotalItems(cached.payload.total);
      setStatusTotals(cached.payload.statusTotals);
      setPrestadoMetrics(cached.payload.prestadoMetrics);
      if (cached.payload.hasFacetOptions && cached.payload.facetOptions) {
        setServerFacetOptions(cached.payload.facetOptions);
      }

      if (!options.preserveSelection) {
        setSelectedIds([]);
        setFocusedRowInfo(null);
      }

      setLoadingPage(false);
      return true;
    }
    if (cached) {
      inventoryPageCacheRef.current.delete(cacheKey);
    }

    loadingPageTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      if (inventoryPageRequestIdRef.current !== requestId) return;
      setLoadingPage(true);
    }, INVENTORY_LOADING_INDICATOR_DELAY_MS);

    const requestController = new AbortController();
    inventoryRequestAbortRef.current = requestController;

    try {
      const params = new URLSearchParams({
        page: String(Math.max(1, options.page)),
        pageSize: String(INVENTORY_PAGE_BLOCK_SIZE)
      });

      const searchValue = options.search.trim();
      if (searchValue.length) {
        params.set("search", searchValue);
      }

      if (options.statusFilter?.trim().length) {
        params.set("statusFilter", options.statusFilter.trim());
      }
      if (options.marcaFilter.trim().length) {
        params.set("marcaFilter", options.marcaFilter.trim());
      }
      if (options.cocheFilter.trim().length) {
        params.set("cocheFilter", options.cocheFilter.trim());
      }
      if (options.piezaFilter.trim().length) {
        params.set("piezaFilter", options.piezaFilter.trim());
      }
      if (includeFacetOptions) {
        params.set("includeFacetOptions", "1");
      }
      options.prestadoDebtorFilters
        .map((value) => value.trim())
        .filter((value) => value.length)
        .forEach((value) => {
          params.append("prestadoDebtorFilter", value);
        });

      const res = await fetch(`/api/inventory?${params.toString()}`, {
        cache: "no-store",
        signal: requestController.signal
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "No se pudo obtener inventario");
      }

      if (inventoryPageRequestIdRef.current !== requestId) {
        return false;
      }

      const incoming: Item[] = Array.isArray(data.items) ? data.items : [];
      const nextTotal = typeof data.total === "number" && data.total >= 0 ? data.total : incoming.length;
      const nextStatusTotals = normalizeStatusTotals(data.statusTotals);
      const nextPrestadoMetrics = normalizePrestadoMetrics(data.prestadoMetrics);
      const shouldUpdateFacetOptions = Object.prototype.hasOwnProperty.call(data, "facetOptions");
      const nextFacetOptions = shouldUpdateFacetOptions ? normalizeFacetOptions(data.facetOptions) : null;

      const payload: InventoryPageCachePayload = {
        items: incoming,
        total: nextTotal,
        statusTotals: nextStatusTotals,
        prestadoMetrics: nextPrestadoMetrics,
        hasFacetOptions: shouldUpdateFacetOptions,
        facetOptions: nextFacetOptions
      };

      inventoryPageCacheRef.current.set(cacheKey, {
        expiresAt: Date.now() + INVENTORY_PAGE_CACHE_TTL_MS,
        payload
      });
      if (inventoryPageCacheRef.current.size > 180) {
        const pruneNow = Date.now();
        for (const [key, entry] of inventoryPageCacheRef.current.entries()) {
          if (entry.expiresAt <= pruneNow) {
            inventoryPageCacheRef.current.delete(key);
          }
        }
        while (inventoryPageCacheRef.current.size > 180) {
          const firstKey = inventoryPageCacheRef.current.keys().next().value;
          if (!firstKey) break;
          inventoryPageCacheRef.current.delete(firstKey);
        }
      }

      const incomingWithLocal = mergeIncomingWithLocalOverrides(payload.items);

      setItems(incomingWithLocal);
      setTotalItems(payload.total);
      setStatusTotals(payload.statusTotals);
      setPrestadoMetrics(payload.prestadoMetrics);
      if (payload.hasFacetOptions && payload.facetOptions) {
        setServerFacetOptions(payload.facetOptions);
      }

      if (!options.preserveSelection) {
        setSelectedIds([]);
        setFocusedRowInfo(null);
      }

      return true;
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return false;
      }
      if (inventoryPageRequestIdRef.current === requestId) {
        setMessage(err?.message || "No se pudo obtener inventario");
      }
      return false;
    } finally {
      if (inventoryRequestAbortRef.current === requestController) {
        inventoryRequestAbortRef.current = null;
      }
      if (inventoryPageRequestIdRef.current === requestId) {
        if (loadingPageTimeoutRef.current) {
          clearTimeout(loadingPageTimeoutRef.current);
          loadingPageTimeoutRef.current = null;
        }
        setLoadingPage(false);
      }
    }
  }, [mergeIncomingWithLocalOverrides]);

  const refresh = useCallback(async () => {
    if (isManualOnly) return;
    if (useServerPagination) {
      inventoryPageCacheRef.current.clear();
      setInventoryReloadSeq((current) => current + 1);
    }
  }, [isManualOnly, useServerPagination]);

  const deleteItems = useCallback(async (ids: string[], password?: string) => {
    if (!ids.length) return;
    setMessage(null);
    try {
      const res = await fetch("/api/inventory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(password ? { ids, password } : { ids })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "No se pudo borrar");
      }
      setMessage(`Eliminados: ${data.deleted ?? ids.length}`);
      await refresh();
    } catch (err: any) {
      setMessage(err.message || "No se pudo borrar");
    }
  }, [refresh]);

  const requestDeleteAuthorization = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    if (!canEditInventory) {
      setMessage("Tu rol no puede borrar registros");
      return;
    }
    const confirmed = window.confirm(
      `Estas por borrar ${ids.length} ${ids.length === 1 ? "registro" : "registros"}. Esta accion no se puede deshacer. ¿Continuar?`
    );
    if (!confirmed) return;
    const passwordInput = window.prompt("Ingresa la contraseña para confirmar el borrado");
    if (passwordInput === null) {
      setMessage("Borrado cancelado");
      return;
    }
    const trimmed = passwordInput.trim();
    if (!trimmed) {
      setMessage("La contraseña no puede estar vacia");
      return;
    }
    if (deletePasswordSecret && trimmed !== deletePasswordSecret) {
      setMessage("Contraseña incorrecta");
      return;
    }
    await deleteItems(ids, trimmed);
  }, [canEditInventory, deleteItems]);

  const performMlAction = useCallback(
    async (action: "pause" | "activate") => {
      if (!canManageMercadoLibre) {
        setMessage("Tu rol no puede sincronizar con Mercado Libre");
        return;
      }
      if (!selectedIds.length) {
        setMessage("Selecciona al menos un registro");
        return;
      }
      const selectedSet = new Set(selectedIds);
      const eligible = items.filter(
        (item) => selectedSet.has(item.id) && item.mlItemId && item.mlItemId.trim().length
      );
      if (!eligible.length) {
        setMessage("Los registros seleccionados no tienen codigo de Mercado Libre");
        return;
      }
      const confirmText =
        action === "pause"
          ? `¿Pausar ${eligible.length} ${eligible.length === 1 ? "publicacion" : "publicaciones"} en Mercado Libre?`
          : `¿Activar ${eligible.length} ${eligible.length === 1 ? "publicacion" : "publicaciones"} en Mercado Libre?`;
      const confirmed = window.confirm(confirmText);
      if (!confirmed) {
        setMessage("Accion cancelada");
        return;
      }

      setMlAction(action);
      setMessage(null);
      try {
        const res = await fetch("/api/mercadolibre/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: eligible.map((item) => item.id), action })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "No se pudo sincronizar con Mercado Libre");
        }
        const parts: string[] = [];
        if (typeof data.successCount === "number") {
          parts.push(`Exitosos: ${data.successCount}`);
        }
        if (Array.isArray(data.failed) && data.failed.length) {
          parts.push(`Fallidos: ${data.failed.length}`);
        }
        setMessage(parts.length ? parts.join(" | ") : "Mercado Libre actualizado");
        await refresh();
      } catch (err: any) {
        setMessage(err.message || "No se pudo sincronizar con Mercado Libre");
      } finally {
        setMlAction(null);
      }
    },
    [canManageMercadoLibre, items, refresh, selectedIds]
  );

  const updateEditedPhotosForFiles = useCallback((nextFiles: File[]) => {
    setEditedPhotos((prev) => {
      if (!Object.keys(prev).length) return prev;
      const allowed = new Set(nextFiles.map((file) => makePhotoKey(file)));
      let changed = false;
      const filtered: Record<string, string> = {};
      Object.entries(prev).forEach(([key, value]) => {
        if (allowed.has(key)) {
          filtered[key] = value;
        } else {
          changed = true;
        }
      });
      return changed ? filtered : prev;
    });
  }, []);

  const mergeManualPhotoFiles = useCallback(
    (incoming: File[]) => {
      if (!incoming.length) return;
      setPhotoFiles((prev) => {
        const seen = new Set<string>();
        const combined = [...prev, ...incoming];
        const unique: File[] = [];
        combined.forEach((file) => {
          const key = makePhotoKey(file);
          if (!seen.has(key)) {
            seen.add(key);
            unique.push(file);
          }
        });
        if (unique.length > MAX_PHOTOS) {
          setMessage(`Maximo ${MAX_PHOTOS} fotos por producto`);
        }
        const capped = unique.slice(0, MAX_PHOTOS);
        updateEditedPhotosForFiles(capped);
        return capped;
      });
    },
    [setMessage, updateEditedPhotosForFiles]
  );

  const handleManualPhotoFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList?.length) return;
      mergeManualPhotoFiles(Array.from(fileList));
    },
    [mergeManualPhotoFiles]
  );

  const removeManualPhoto = useCallback(
    (index: number) => {
      setPhotoFiles((prev) => {
        const next = prev.filter((_, idx) => idx !== index);
        updateEditedPhotosForFiles(next);
        return next;
      });
    },
    [updateEditedPhotosForFiles]
  );

  const clearManualPhotos = useCallback(() => {
    setPhotoFiles([]);
    setEditedPhotos({});
    if (photoInputRef.current) {
      photoInputRef.current.value = "";
    }
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
    }
  }, []);

  const moveManualPhoto = useCallback((fromIndex: number, toIndex: number) => {
    setPhotoFiles((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length) {
        return prev;
      }
      if (fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const setManualCoverPhoto = useCallback(
    (index: number) => {
      if (index <= 0 || index >= photoFiles.length) return;
      moveManualPhoto(index, 0);
    },
    [photoFiles.length, moveManualPhoto]
  );

  useEffect(() => {
    setManualPhotoPreviewUrls((prev) => {
      const next = { ...prev };
      const activeKeys = new Set(photoFiles.map((file) => makePhotoKey(file)));

      Object.entries(next).forEach(([key, url]) => {
        if (!activeKeys.has(key)) {
          URL.revokeObjectURL(url);
          delete next[key];
        }
      });

      photoFiles.forEach((file) => {
        const key = makePhotoKey(file);
        if (!next[key]) {
          next[key] = URL.createObjectURL(file);
        }
      });

      return next;
    });
  }, [photoFiles]);

  useEffect(() => {
    manualPhotoPreviewUrlsRef.current = manualPhotoPreviewUrls;
  }, [manualPhotoPreviewUrls]);

  useEffect(() => {
    return () => {
      Object.values(manualPhotoPreviewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const drawDataUrlOnCanvas = useCallback((dataUrl: string) => {
    const canvas = editorCanvasRef.current;
    if (!canvas) return;
    setPhotoEditorBusy(true);
    setPhotoEditorError(null);
    setPhotoEditorReady(false);
    setIsDrawingStroke(false);
    setPendingText(null);
    const img = new Image();
    img.onload = () => {
      const maxDim = MAX_PHOTO_DIMENSION;
      const width = img.width || maxDim;
      const height = img.height || maxDim;
      const scale = width > maxDim || height > maxDim ? Math.min(maxDim / width, maxDim / height) : 1;
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setPhotoEditorError("No se pudo preparar el lienzo");
        setPhotoEditorBusy(false);
        return;
      }
      ctx.clearRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      setPhotoEditorBusy(false);
      setPhotoEditorReady(true);
    };
    img.onerror = () => {
      setPhotoEditorError("No se pudo cargar la imagen");
      setPhotoEditorBusy(false);
    };
    img.src = dataUrl;
  }, []);

  useEffect(() => {
    if (!photoEditor) {
      setPhotoEditorReady(false);
      return;
    }
    drawDataUrlOnCanvas(photoEditor.dataUrl);
  }, [photoEditor, drawDataUrlOnCanvas]);

  const openPhotoEditorForFile = useCallback(
    async (file: File) => {
      try {
        const key = makePhotoKey(file);
        const baseData = editedPhotos[key] ?? (await readFileAsDataUrl(file));
        const normalized = await normalizeDataUrlSize(baseData);
        photoEditorBaseRef.current = normalized;
        setPhotoEditor({
          title: file.name,
          dataUrl: normalized,
          target: { type: "manual", key }
        });
        setDrawingMode(false);
        setAnnotationTool("brush");
        setBrushSize(4);
        setDrawingColor(drawingColors[0]);
        setPendingText(null);
        setPhotoEditorError(null);
      } catch (err: any) {
        setMessage(err?.message || "No se pudo abrir el editor de fotos");
      }
    },
    [editedPhotos, setMessage]
  );

  const openPhotoEditorForModalPhoto = useCallback(
    async (index: number) => {
      const current = modalPhotos[index];
      if (!current) return;
      try {
        const normalized = await normalizeDataUrlSize(current);
        photoEditorBaseRef.current = normalized;
        setPhotoEditor({
          title: `${photoModal?.title || "Item"} · Foto ${index + 1}`,
          dataUrl: normalized,
          target: { type: "modal", index }
        });
        setDrawingMode(false);
        setAnnotationTool("brush");
        setBrushSize(4);
        setDrawingColor(drawingColors[0]);
        setPendingText(null);
        setPhotoEditorError(null);
      } catch (err: any) {
        setPhotoModalError(err?.message || "No se pudo abrir el editor de la foto");
      }
    },
    [modalPhotos, photoModal]
  );

  const closePhotoEditor = useCallback(() => {
    setPhotoEditor(null);
    setPhotoEditorError(null);
    setDrawingMode(false);
    setAnnotationTool("brush");
    setPendingText(null);
    setIsDrawingStroke(false);
    setPhotoEditorReady(false);
    shapeSnapshotRef.current = null;
    shapeStartPointRef.current = null;
    photoEditorBaseRef.current = null;
  }, []);

  const resetEditorCanvas = useCallback(() => {
    if (!photoEditor) return;
    const base = photoEditorBaseRef.current ?? photoEditor.dataUrl;
    drawDataUrlOnCanvas(base);
    setDrawingMode(false);
    setAnnotationTool("brush");
    shapeSnapshotRef.current = null;
    shapeStartPointRef.current = null;
  }, [photoEditor, drawDataUrlOnCanvas]);

  const rotateEditorCanvas = useCallback(
    (direction: "left" | "right") => {
      if (!photoEditorReady || !editorCanvasRef.current) return;
      const canvas = editorCanvasRef.current;
      const snapshot = document.createElement("canvas");
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      const snapshotCtx = snapshot.getContext("2d");
      if (!snapshotCtx) return;
      snapshotCtx.drawImage(canvas, 0, 0);
      const newWidth = snapshot.height;
      const newHeight = snapshot.width;
      canvas.width = newWidth;
      canvas.height = newHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.clearRect(0, 0, newWidth, newHeight);
      if (direction === "left") {
        ctx.translate(0, newHeight);
        ctx.rotate(-Math.PI / 2);
      } else {
        ctx.translate(newWidth, 0);
        ctx.rotate(Math.PI / 2);
      }
      ctx.drawImage(snapshot, 0, 0);
      ctx.restore();
    },
    [photoEditorReady]
  );

  const flipEditorCanvas = useCallback(
    (axis: "horizontal" | "vertical") => {
      if (!photoEditorReady || !editorCanvasRef.current) return;
      const canvas = editorCanvasRef.current;
      const snapshot = document.createElement("canvas");
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      const snapshotCtx = snapshot.getContext("2d");
      if (!snapshotCtx) return;
      snapshotCtx.drawImage(canvas, 0, 0);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (axis === "horizontal") {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      } else {
        ctx.translate(0, canvas.height);
        ctx.scale(1, -1);
      }
      ctx.drawImage(snapshot, 0, 0);
      ctx.restore();
    },
    [photoEditorReady]
  );

  const getCanvasPoint = (evt: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = editorCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((evt.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const drawCircleAnnotation = useCallback(
    (ctx: CanvasRenderingContext2D, start: { x: number; y: number }, end: { x: number; y: number }) => {
      const radius = Math.hypot(end.x - start.x, end.y - start.y);
      ctx.strokeStyle = drawingColor;
      ctx.lineWidth = brushSize;
      ctx.beginPath();
      ctx.arc(start.x, start.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    },
    [brushSize, drawingColor]
  );

  const drawArrowAnnotation = useCallback(
    (ctx: CanvasRenderingContext2D, start: { x: number; y: number }, end: { x: number; y: number }) => {
      const headLength = Math.max(12, brushSize * 3);
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      ctx.strokeStyle = drawingColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(
        end.x - headLength * Math.cos(angle - Math.PI / 6),
        end.y - headLength * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        end.x - headLength * Math.cos(angle + Math.PI / 6),
        end.y - headLength * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fillStyle = drawingColor;
      ctx.fill();
    },
    [brushSize, drawingColor]
  );

  const handleEditorPointerDown = useCallback(
    (evt: React.PointerEvent<HTMLCanvasElement>) => {
      if (!photoEditorReady || !editorCanvasRef.current) return;
      const canvas = editorCanvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (pendingText) {
        evt.preventDefault();
        const { x, y } = getCanvasPoint(evt);
        ctx.fillStyle = drawingColor;
        ctx.font = `${Math.max(18, Math.round(canvas.width * 0.04))}px 'Inter', 'Segoe UI', sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(pendingText, x, y);
        setPendingText(null);
        return;
      }
      if (!drawingMode) return;
      evt.preventDefault();
      const { x, y } = getCanvasPoint(evt);
      if (annotationTool !== "brush") {
        const snapshot = document.createElement("canvas");
        snapshot.width = canvas.width;
        snapshot.height = canvas.height;
        const snapshotCtx = snapshot.getContext("2d");
        if (!snapshotCtx) return;
        snapshotCtx.drawImage(canvas, 0, 0);
        shapeSnapshotRef.current = snapshot;
        shapeStartPointRef.current = { x, y };
        setIsDrawingStroke(true);
        canvas.setPointerCapture?.(evt.pointerId);
        return;
      }
      ctx.strokeStyle = drawingColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(x, y);
      setIsDrawingStroke(true);
      canvas.setPointerCapture?.(evt.pointerId);
    },
    [annotationTool, brushSize, drawingColor, drawingMode, pendingText, photoEditorReady]
  );

  const handleEditorPointerMove = useCallback(
    (evt: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingMode || !isDrawingStroke || !editorCanvasRef.current) return;
      evt.preventDefault();
      const canvas = editorCanvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { x, y } = getCanvasPoint(evt);
      if (annotationTool === "circle" || annotationTool === "arrow") {
        const snapshot = shapeSnapshotRef.current;
        const startPoint = shapeStartPointRef.current;
        if (!snapshot || !startPoint) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(snapshot, 0, 0);
        if (annotationTool === "circle") {
          drawCircleAnnotation(ctx, startPoint, { x, y });
        } else {
          drawArrowAnnotation(ctx, startPoint, { x, y });
        }
        return;
      }
      ctx.lineTo(x, y);
      ctx.stroke();
    },
    [annotationTool, drawArrowAnnotation, drawCircleAnnotation, drawingMode, isDrawingStroke]
  );

  const handleEditorPointerUp = useCallback(
    (evt: React.PointerEvent<HTMLCanvasElement>) => {
      if (!editorCanvasRef.current) return;
      const canvas = editorCanvasRef.current;
      const ctx = canvas.getContext("2d");
      if (drawingMode && isDrawingStroke && ctx && annotationTool === "brush") {
        evt.preventDefault();
        ctx.closePath();
      }
      if (drawingMode && isDrawingStroke && ctx && (annotationTool === "circle" || annotationTool === "arrow")) {
        const snapshot = shapeSnapshotRef.current;
        const startPoint = shapeStartPointRef.current;
        if (snapshot && startPoint) {
          const endPoint = getCanvasPoint(evt);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(snapshot, 0, 0);
          if (annotationTool === "circle") {
            drawCircleAnnotation(ctx, startPoint, endPoint);
          } else {
            drawArrowAnnotation(ctx, startPoint, endPoint);
          }
        }
      }
      canvas.releasePointerCapture?.(evt.pointerId);
      shapeSnapshotRef.current = null;
      shapeStartPointRef.current = null;
      setIsDrawingStroke(false);
    },
    [annotationTool, drawArrowAnnotation, drawCircleAnnotation, drawingMode, isDrawingStroke]
  );

  const handleAddText = useCallback(() => {
    if (!photoEditorReady) return;
    const text = window.prompt("Texto a agregar");
    if (!text) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    setPendingText(trimmed);
  }, [photoEditorReady]);

  const handleSaveEditedPhoto = useCallback(async () => {
    if (!photoEditor || !editorCanvasRef.current) return;
    try {
      setPhotoEditorSaving(true);
      const dataUrl = editorCanvasRef.current.toDataURL("image/jpeg", PHOTO_QUALITY);
      const normalized = await normalizeDataUrlSize(dataUrl);
      const target = photoEditor.target;
      if (target.type === "manual") {
        const targetKey = target.key;
        setEditedPhotos((prev) => ({ ...prev, [targetKey]: normalized }));
      } else {
        const targetIndex = target.index;
        setModalPhotos((prev) => {
          if (targetIndex < 0 || targetIndex >= prev.length) return prev;
          const next = [...prev];
          next[targetIndex] = normalized;
          return next;
        });
        setModalActiveIndex(targetIndex);
      }
      setPhotoEditor(null);
      photoEditorBaseRef.current = null;
      setDrawingMode(false);
      setAnnotationTool("brush");
      setPendingText(null);
      setIsDrawingStroke(false);
      shapeSnapshotRef.current = null;
      shapeStartPointRef.current = null;
    } catch (err: any) {
      setPhotoEditorError(err?.message || "No se pudo guardar la foto editada");
    } finally {
      setPhotoEditorSaving(false);
    }
  }, [photoEditor]);

  const openPhotoModal = useCallback(
    async (item: Item) => {
      if (!canEditInventory) return;
      setPhotoModal({ id: item.id, title: item.skuInternal || "Item" });
      setModalPhotos([]);
      setPhotoModalError(null);
      setModalActiveIndex(0);
      setPhotoModalLoading(true);
      if (modalPhotoInputRef.current) {
        modalPhotoInputRef.current.value = "";
      }
      try {
        const res = await fetch(`/api/inventory/${item.id}/photos`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "No se pudieron obtener las fotos");
        }
        const existing = sanitizePhotos(data.photos);
        setModalPhotos(existing);
      } catch (err: any) {
        setPhotoModalError(err?.message || "No se pudieron obtener las fotos");
      } finally {
        setPhotoModalLoading(false);
      }
    },
    [canEditInventory]
  );

  const closePhotoModal = useCallback(() => {
    setPhotoModal(null);
    setModalPhotos([]);
    setPhotoModalError(null);
    setModalActiveIndex(0);
    setPhotoModalLoading(false);
    if (modalPhotoInputRef.current) {
      modalPhotoInputRef.current.value = "";
    }
  }, []);

  const getThumbnailSrc = useCallback(
    (itemId: string) => {
      const version = thumbnailVersionById[itemId] ?? 0;
      return version > 0
        ? `/api/inventory/${itemId}/thumbnail?v=${version}`
        : `/api/inventory/${itemId}/thumbnail`;
    },
    [thumbnailVersionById]
  );

  const handleModalFileSelection = async (fileList: FileList | null) => {
    if (!photoModal || !fileList?.length) return;
    setPhotoModalError(null);
    const remainingSlots = MAX_PHOTOS - modalPhotos.length;
    if (remainingSlots <= 0) {
      setPhotoModalError(`Maximo ${MAX_PHOTOS} fotos por producto`);
      if (modalPhotoInputRef.current) modalPhotoInputRef.current.value = "";
      return;
    }
    try {
      const files = Array.from(fileList).slice(0, remainingSlots);
      const dataUrls = await Promise.all(files.map((file) => fileToDataUrl(file)));
      setModalPhotos((prev) => {
        const next = [...prev, ...dataUrls].slice(0, MAX_PHOTOS);
        if (!prev.length && next.length) {
          setModalActiveIndex(0);
        }
        return next;
      });
    } catch (err: any) {
      setPhotoModalError(err.message || "No se pudieron leer las imagenes");
    } finally {
      if (modalPhotoInputRef.current) {
        modalPhotoInputRef.current.value = "";
      }
    }
  };

  const removeModalPhoto = (index: number) => {
    setPhotoModalError(null);
    setModalPhotos((prev) => {
      const next = prev.filter((_, idx) => idx !== index);
      setModalActiveIndex((current) => {
        if (!next.length) return 0;
        if (current === index) {
          return Math.min(index, next.length - 1);
        }
        if (current > index) {
          return current - 1;
        }
        return current;
      });
      return next;
    });
  };

  const moveModalPhoto = useCallback((fromIndex: number, toIndex: number) => {
    setModalPhotos((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length) {
        return prev;
      }
      if (fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setModalActiveIndex((current) => {
      if (current === fromIndex) return toIndex;
      if (fromIndex < current && current <= toIndex) return current - 1;
      if (toIndex <= current && current < fromIndex) return current + 1;
      return current;
    });
  }, []);

  const moveActiveModalPhoto = useCallback(
    (direction: "left" | "right") => {
      if (!modalPhotos.length) return;
      const from = modalActiveIndex;
      const to = direction === "left"
        ? Math.max(0, from - 1)
        : Math.min(modalPhotos.length - 1, from + 1);
      if (from === to) return;
      moveModalPhoto(from, to);
    },
    [modalActiveIndex, modalPhotos.length, moveModalPhoto]
  );

  const setModalCoverPhoto = useCallback(
    (index: number) => {
      if (index <= 0 || index >= modalPhotos.length) return;
      moveModalPhoto(index, 0);
    },
    [modalPhotos.length, moveModalPhoto]
  );

  const saveModalPhotos = async () => {
    if (!photoModal) return;
    if (!canEditInventory) {
      setPhotoModalError("Tu rol no puede editar fotos");
      return;
    }
    setPhotoModalSaving(true);
    setPhotoModalError(null);
    const photosToSave = modalPhotos.slice(0, MAX_PHOTOS);
    try {
      const res = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: photoModal.id, photos: photosToSave })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "No se pudieron actualizar las fotos");
      }
      setItems((curr) =>
        curr.map((item) =>
          item.id === photoModal.id ? { ...item, photoCount: photosToSave.length } : item
        )
      );
      setThumbnailVersionById((prev) => ({ ...prev, [photoModal.id]: (prev[photoModal.id] ?? 0) + 1 }));
      closePhotoModal();
      setMessage("Fotos actualizadas");
    } catch (err: any) {
      setPhotoModalError(err.message || "No se pudieron actualizar las fotos");
    } finally {
      setPhotoModalSaving(false);
    }
  };

  const showPrevModalPhoto = () => {
    if (!modalPhotos.length) return;
    setModalActiveIndex((current) => (current === 0 ? modalPhotos.length - 1 : current - 1));
  };

  const showNextModalPhoto = () => {
    if (!modalPhotos.length) return;
    setModalActiveIndex((current) => (current + 1) % modalPhotos.length);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateManual) {
      setMessage("Tu rol no puede agregar productos");
      return;
    }
    const confirmed = window.confirm("¿Deseas agregar este producto al inventario?");
    if (!confirmed) return;
    setPending(true);
    setMessage(null);
    try {
      const anoDesdeSafe = Number.isFinite(anoDesdeNumber as number) ? anoDesdeNumber : undefined;
      const anoHastaSafe = Number.isFinite(anoHastaNumber as number) ? anoHastaNumber : undefined;

      const photosPayload = await Promise.all(
        photoFiles.slice(0, MAX_PHOTOS).map(async (file) => {
          const edited = editedPhotos[makePhotoKey(file)];
          if (edited) return edited;
          return fileToDataUrl(file);
        })
      );

      const extraDataPayload: Record<string, any> = {
        estatus_interno: toUpper(form.estatusInterno),
        fecha_ingreso: new Date().toISOString(),
        origen: toUpper(form.origen),
        coche: toUpper(form.coche),
        pieza: toUpper(form.pieza),
        marca: toUpper(form.marca),
        ano_desde: anoDesdeSafe,
        ano_hasta: anoHastaSafe,
        ubicacion: toUpper(form.ubicacion),
        precio_compra: form.precioCompra ? Number(form.precioCompra) : undefined
      };

      if (photosPayload.length) {
        extraDataPayload.photos = photosPayload;
      }

      const skuInput = toUpper(form.skuInternal) ?? "";
      const suggestedSku = manualSkuSuggestionPrefix ? manualSkuSuggestion : "";
      const resolvedSkuInternal = skuInput || suggestedSku;
      if (!resolvedSkuInternal) {
        throw new Error("No se pudo generar el SKU. Revisa la nomenclatura de la pieza.");
      }

      const payload = {
        skuInternal: resolvedSkuInternal,
        mlItemId: toUpper(form.mlItemId) ?? undefined,
        status: "active",
        price: form.price ? Number(form.price) : undefined,
        stock: form.stock ? Number(form.stock) : undefined,
        extraData: extraDataPayload
      };
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Error al crear item");
      }
      setForm({
        skuInternal: "",
        mlItemId: "",
        estatusInterno: "",
        stock: "",
        pieza: "",
        marca: "",
        coche: "",
        anoDesde: "",
        anoHasta: "",
        origen: "",
        price: "",
        precioCompra: "",
        ubicacion: ""
      });
      setManualSkuEdited(false);

      const usedPrefix = manualSkuSuggestionPrefix ?? resolvedManualSkuPrefix;
      const usedNumber = usedPrefix ? parseSkuSuffixNumber(resolvedSkuInternal, usedPrefix) : null;
      if (usedPrefix && usedNumber) {
        const cached = manualSkuSequenceCacheRef.current.get(usedPrefix) ?? 1;
        const nextNumber = Math.max(cached, usedNumber + 1);
        manualSkuSequenceCacheRef.current.set(usedPrefix, nextNumber);
        setManualSkuSuggestion(formatSkuFromPrefixNumber(usedPrefix, nextNumber));
        setManualSkuSuggestionPrefix(usedPrefix);
      }

      clearManualPhotos();
      setMessage("Item creado");
      await refresh();
    } catch (err: any) {
      setMessage(err.message || "No se pudo crear");
    } finally {
      setPending(false);
    }
  };

  const onUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canImportInventory) {
      setUploadMessage("Tu rol no puede importar archivos");
      return;
    }
    const fileInput = (e.currentTarget.elements.namedItem("file") as HTMLInputElement) || null;
    const file = fileInput?.files?.[0];
    if (!file) {
      setUploadMessage("Selecciona un archivo");
      return;
    }
    setUploading(true);
    setUploadMessage(null);
    setUploadErrors([]);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/inventory/import", {
        method: "POST",
        body: formData
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadMessage(data.error || "No se pudo importar");
        setUploadErrors(data.errors || []);
        return;
      }
      setUploadMessage(`Importados: ${data.inserted}`);
      setUploadErrors(data.errors || []);
      await refresh();
      if (fileInput) fileInput.value = "";
    } catch (err: any) {
      setUploadMessage(err.message || "No se pudo importar");
    } finally {
      setUploading(false);
    }
  };

  const registerSoldItemInFinance = useCallback(
    async ({
      piece,
      skuInternal,
      defaultAmount,
      saleDate
    }: {
      piece: string;
      skuInternal: string;
      defaultAmount?: number | null;
      saleDate?: string | null;
    }): Promise<SoldFinanceRegistrationResult> => {
      const shouldRegister = window.confirm("¿Quieres agregar esta pieza vendida a finanzas?");
      if (!shouldRegister) return { status: "skipped" };

      const typeAnswer = window.prompt(
        "¿En qué sección quieres registrarla?\nEscribe INGRESO o EGRESO",
        "INGRESO"
      );
      if (typeAnswer === null) return { status: "skipped" };

      const normalizedType = typeAnswer.trim().toUpperCase();
      if (normalizedType !== "INGRESO" && normalizedType !== "EGRESO") {
        return {
          status: "failed",
          message: "Venta marcada como VENDIDO, pero no se registró en finanzas: elige INGRESO o EGRESO"
        };
      }

      const entryType: FinanceEntryType = normalizedType === "INGRESO" ? "income" : "expense";

      const defaultAmountText =
        defaultAmount !== null &&
        defaultAmount !== undefined &&
        Number.isFinite(defaultAmount) &&
        defaultAmount > 0
          ? String(defaultAmount)
          : "";

      const amountAnswer = window.prompt(
        "¿En cuánto se vendió la pieza?\nPuedes cambiar el costo para registrarlo en finanzas.",
        defaultAmountText
      );
      if (amountAnswer === null) return { status: "skipped" };

      const amount = parsePositiveAmountInput(amountAnswer);
      if (!amount) {
        return {
          status: "failed",
          message: "Venta marcada como VENDIDO, pero no se registró en finanzas: monto inválido"
        };
      }

      const concept = ((piece || "PIEZA VENDIDA").trim().toUpperCase() || "PIEZA VENDIDA").slice(0, 180);
      const code = (skuInternal ?? "").toString().trim().toUpperCase() || null;
      const date = toDateOnly(saleDate);

      const response = await fetch("/api/finance/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: entryType,
          date,
          concept,
          code,
          amount
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          status: "failed",
          message:
            payload?.error ||
            "Venta marcada como VENDIDO, pero no se pudo registrar en finanzas"
        };
      }

      return { status: "registered", entryType };
    },
    []
  );

  const updateEstatusInterno = useCallback(async (
    id: string,
    value: string,
    overridePrestadoVendidoA?: string | null,
    overridePrice?: number | null
  ) => {
    const normalized = value.trim().toUpperCase();
    const current = items.find((it) => it.id === id);
    const hasMlItem = Boolean(current?.mlItemId);
    if (!hasMlItem && (normalized === "PRESTADO" || normalized === "ML")) {
      setMessage("Este registro no tiene código de Mercado Libre; se guardará el estatus interno sin sincronizar.");
    }
    const nextStatus =
      normalized === "VENDIDO" || normalized === "SIN SUBIR"
        ? "inactive"
        : normalized === "PRESTADO"
        ? hasMlItem
          ? "paused"
          : undefined
        : normalized === "ML"
        ? hasMlItem
          ? "active"
          : undefined
        : undefined;

    const shouldStampDate = normalized === "PRESTADO" || normalized === "VENDIDO";
    const fechaPrestamoPago = shouldStampDate ? new Date().toISOString() : null;
    const currentPrestadoVendidoA = current?.extraData?.prestado_vendido_a ?? null;
    const hasOverride = typeof overridePrestadoVendidoA !== "undefined";
    const prestadoVendidoA = hasOverride
      ? overridePrestadoVendidoA ?? null
      : currentPrestadoVendidoA;
    const hasPriceOverride = typeof overridePrice === "number" && Number.isFinite(overridePrice);

    localEstatusInternoRef.current.set(id, {
      value: normalized,
      updatedAt: Date.now(),
      prestadoVendidoA
    });

    const prevItems = items.map((item) => ({
      ...item,
      extraData: item.extraData ? { ...item.extraData } : item.extraData
    }));

    setUpdatingIds((prev) => [...prev, id]);
    setItems((curr) =>
      curr.map((item) =>
        item.id === id
          ? {
              ...item,
              status: nextStatus ?? item.status,
              price: hasPriceOverride ? overridePrice : item.price,
              extraData: {
                ...(item.extraData ?? {}),
                estatus_interno: normalized || undefined,
                fecha_prestamo_pago: shouldStampDate ? fechaPrestamoPago : undefined,
                  prestado_vendido_a: hasOverride
                    ? prestadoVendidoA || undefined
                    : item.extraData?.prestado_vendido_a
              }
            }
          : item
      )
    );

    try {
      const res = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          estatusInterno: normalized || null,
          status: nextStatus,
          forceMlSync: normalized === "ML",
          fechaPrestamoPago,
          prestadoVendidoA,
          price: hasPriceOverride ? overridePrice : undefined
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "No se pudo actualizar");
      }

      let financeResult: SoldFinanceRegistrationResult = { status: "skipped" };
      if (normalized === "VENDIDO" && current) {
        const piece =
          (current.extraData?.pieza ?? current.title ?? "").toString().trim().toUpperCase() ||
          "PIEZA VENDIDA";
        financeResult = await registerSoldItemInFinance({
          piece,
          skuInternal: current.skuInternal,
          defaultAmount: hasPriceOverride ? overridePrice : current.price,
          saleDate: fechaPrestamoPago
        });
      }

      const financeMessage =
        financeResult.status === "registered"
          ? financeResult.entryType === "income"
            ? " y registrada en ingresos"
            : " y registrada en egresos"
          : "";

      if (data?.mlSyncError) {
        setMessage(`Estatus interno guardado${financeMessage}, pero ML falló: ${data.mlSyncError}`);
      } else if (financeResult.status === "failed") {
        setMessage(financeResult.message);
      } else if (financeResult.status === "registered") {
        setMessage(`Estatus interno guardado${financeMessage}`);
      }
    } catch (err: any) {
      setItems(prevItems);
      setMessage(err.message || "No se pudo actualizar");
      localEstatusInternoRef.current.delete(id);
    } finally {
      setUpdatingIds((prev) => prev.filter((x) => x !== id));
    }
  }, [items, registerSoldItemInFinance]);

  const updateOrigen = useCallback(async (id: string, value: string) => {
    const upper = value.trim().toUpperCase();
    const prevItems = items.map((item) => ({
      ...item,
      extraData: item.extraData ? { ...item.extraData } : item.extraData
    }));

    setUpdatingIds((prev) => [...prev, id]);
    setItems((curr) =>
      curr.map((item) =>
        item.id === id
          ? {
              ...item,
              extraData: {
                ...(item.extraData ?? {}),
                origen: upper || undefined
              }
            }
          : item
      )
    );

    try {
      const res = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, origen: upper || null })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "No se pudo actualizar");
      }
    } catch (err: any) {
      setItems(prevItems);
      setMessage(err.message || "No se pudo actualizar");
    } finally {
      setUpdatingIds((prev) => prev.filter((x) => x !== id));
    }
  }, [items]);

  const updateUbicacion = useCallback(async (id: string, value: string) => {
    const upper = value.trim().toUpperCase();
    const prevItems = items.map((item) => ({
      ...item,
      extraData: item.extraData ? { ...item.extraData } : item.extraData
    }));

    setUpdatingIds((prev) => [...prev, id]);
    setItems((curr) =>
      curr.map((item) =>
        item.id === id
          ? {
              ...item,
              extraData: {
                ...(item.extraData ?? {}),
                ubicacion: upper || undefined
              }
            }
          : item
      )
    );

    try {
      const res = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ubicacion: upper || null })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "No se pudo actualizar");
      }
    } catch (err: any) {
      setItems(prevItems);
      setMessage(err.message || "No se pudo actualizar");
    } finally {
      setUpdatingIds((prev) => prev.filter((x) => x !== id));
    }
  }, [items]);

  const updateMlItemId = useCallback(async (id: string, value: string) => {
    const upper = value.trim().toUpperCase();
    const nextValue = upper.length ? upper : null;
    const prevItems = items.map((item) => ({
      ...item,
      extraData: item.extraData ? { ...item.extraData } : item.extraData
    }));

    setUpdatingIds((prev) => [...prev, id]);
    setItems((curr) =>
      curr.map((item) => (item.id === id ? { ...item, mlItemId: nextValue } : item))
    );

    try {
      const res = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, mlItemId: nextValue })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "No se pudo actualizar");
      }
    } catch (err: any) {
      setItems(prevItems);
      setMessage(err.message || "No se pudo actualizar");
    } finally {
      setUpdatingIds((prev) => prev.filter((x) => x !== id));
    }
  }, [items]);

  const updatePrestadoVendidoA = useCallback(async (id: string, value: string) => {
    const upper = value.trim().toUpperCase();
    const prevItems = items.map((item) => ({
      ...item,
      extraData: item.extraData ? { ...item.extraData } : item.extraData
    }));

    setUpdatingIds((prev) => [...prev, id]);
    setItems((curr) =>
      curr.map((item) =>
        item.id === id
          ? {
              ...item,
              extraData: {
                ...(item.extraData ?? {}),
                prestado_vendido_a: upper || undefined
              }
            }
          : item
      )
    );

    try {
      const res = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, prestadoVendidoA: upper || null })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "No se pudo actualizar");
      }
    } catch (err: any) {
      setItems(prevItems);
      setMessage(err.message || "No se pudo actualizar");
    } finally {
      setUpdatingIds((prev) => prev.filter((x) => x !== id));
    }
  }, [items]);

  const updatePrice = useCallback(async (id: string, value: number | null) => {
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      setMessage("Precio invalido");
      return;
    }

    const prevItems = items.map((item) => ({
      ...item,
      extraData: item.extraData ? { ...item.extraData } : item.extraData
    }));

    setItems((curr) =>
      curr.map((item) => (item.id === id ? { ...item, price: value ?? null } : item))
    );

    try {
      const res = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, price: value })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "No se pudo actualizar el precio");
      }
    } catch (err: any) {
      setItems(prevItems);
      setMessage(err.message || "No se pudo actualizar el precio");
    }
  }, [items]);

  const brandSuggestions = Array.from(
    new Set([
      ...brandOptions,
      ...items
        .map((item) => item.extraData?.marca)
        .filter((m): m is string => Boolean(m && m.trim()))
        .map((m) => m.toUpperCase())
    ])
  ).sort();

  const skuSuggestions = Array.from(
    new Set(
      items
        .map((item) => item.skuInternal)
        .filter((s): s is string => Boolean(s && s.trim()))
        .map((s) => s.toUpperCase())
    )
  ).sort();

  const piezaSuggestions = Array.from(
    new Set(
      items
        .map((item) => item.extraData?.pieza)
        .filter((p): p is string => Boolean(p && p.trim()))
        .map((p) => p.toUpperCase())
    )
  ).sort();

  const ubicacionSuggestions = Array.from(
    new Set(
      items
        .map((item) => item.extraData?.ubicacion)
        .filter((u): u is string => Boolean(u && u.trim()))
        .map((u) => u.toUpperCase())
    )
  ).sort();

  const modelOptions = (() => {
    const base = brandModels[form.marca] ?? [];
    const existing = items
      .filter((item) => (item.extraData?.marca ?? "").toString().toUpperCase() === form.marca)
      .map((item) => item.extraData?.coche)
      .filter((c): c is string => Boolean(c && c.trim()))
      .map((c) => c.toUpperCase());
    return Array.from(new Set([...base, ...existing])).sort();
  })();

  const editModelOptions = useMemo(() => {
    const brand = (inventoryEditForm?.marca ?? "").toString().trim().toUpperCase();
    if (!brand) return [];
    const base = brandModels[brand] ?? [];
    const existing = items
      .filter((item) => (item.extraData?.marca ?? "").toString().toUpperCase() === brand)
      .map((item) => item.extraData?.coche)
      .filter((c): c is string => Boolean(c && c.trim()))
      .map((c) => c.toUpperCase());
    return Array.from(new Set([...base, ...existing])).sort();
  }, [inventoryEditForm?.marca, items]);

  const resolvedManualSkuPrefix = useMemo(() => {
    const piece = normalizeManualNomenclaturePiece(form.pieza);
    if (!piece.length) return null;

    const matched = manualNomenclatureGroups.find((group) =>
      group.pieces.some((entry) => normalizeManualNomenclaturePiece(entry.piece) === piece)
    );

    return matched?.prefix ?? null;
  }, [form.pieza, manualNomenclatureGroups]);

  const selectedManualNomenclature = useMemo(() => {
    if (!manualNomenclatureSelectedId) return null;
    return manualNomenclatureGroups.find((group) => group.id === manualNomenclatureSelectedId) ?? null;
  }, [manualNomenclatureGroups, manualNomenclatureSelectedId]);

  const fetchManualNomenclatures = useCallback(async (preferredSelectionId?: string) => {
    if (!isManualOnly) return;

    setManualNomenclatureLoading(true);
    setManualNomenclatureError(null);

    try {
      const response = await fetch("/api/inventory/nomenclatures", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as
        | (ManualNomenclaturesResponse & { error?: string })
        | null;

      if (!response.ok) {
        throw new Error(payload?.error || "No se pudieron cargar las nomenclaturas");
      }

      const groups = Array.isArray(payload?.items)
        ? payload.items
            .map((group) => {
              const prefix = normalizeManualNomenclaturePrefix((group.prefix ?? "").toString());
              if (!prefix.length) return null;

              const pieces = Array.isArray(group.pieces)
                ? group.pieces
                    .map((piece) => {
                      const normalizedPiece = normalizeManualNomenclaturePiece((piece.piece ?? "").toString());
                      if (!normalizedPiece.length) return null;
                      return { id: piece.id, piece: normalizedPiece } satisfies ManualNomenclaturePieceEntry;
                    })
                    .filter((piece): piece is ManualNomenclaturePieceEntry => Boolean(piece))
                    .sort((a, b) => a.piece.localeCompare(b.piece, "es"))
                : [];

              return {
                id: group.id,
                prefix,
                pieces
              } satisfies ManualNomenclatureGroup;
            })
            .filter((group): group is ManualNomenclatureGroup => Boolean(group))
            .sort((a, b) => a.prefix.localeCompare(b.prefix, "es"))
        : [];

      setManualNomenclatureGroups(groups);
      setManualNomenclatureSelectedId((current) => {
        const desired = (preferredSelectionId ?? "").trim();
        if (desired.length && groups.some((group) => group.id === desired)) return desired;
        if (current.length && groups.some((group) => group.id === current)) return current;
        return groups[0]?.id ?? "";
      });
    } catch (error: any) {
      console.error("No se pudieron cargar las nomenclaturas", error);
      setManualNomenclatureError(error?.message || "No se pudieron cargar las nomenclaturas");
    } finally {
      setManualNomenclatureLoading(false);
    }
  }, [isManualOnly]);

  const applyManualSkuSuggestion = useCallback((suggestion: string, force = false) => {
    const normalized = suggestion.trim().toUpperCase();
    if (!normalized.length) return;
    setManualSkuSuggestion(normalized);
    setForm((current) => {
      const currentSku = (current.skuInternal ?? "").toString().trim().toUpperCase();
      if (!force && manualSkuEdited && currentSku.length) return current;
      if (currentSku === normalized) return current;
      return { ...current, skuInternal: normalized };
    });
  }, [manualSkuEdited]);

  useEffect(() => {
    if (!isManualOnly) return;
    void fetchManualNomenclatures();
  }, [fetchManualNomenclatures, isManualOnly]);

  useEffect(() => {
    if (!isManualOnly) return;

    if (manualSkuRequestAbortRef.current) {
      manualSkuRequestAbortRef.current.abort();
      manualSkuRequestAbortRef.current = null;
    }

    setManualSkuSuggestionError(null);

    const piece = normalizeManualNomenclaturePiece(form.pieza);
    const hasExactPieceMatch = manualNomenclatureGroups.some((group) =>
      group.pieces.some((entry) => normalizeManualNomenclaturePiece(entry.piece) === piece)
    );

    if (!piece.length || !hasExactPieceMatch) {
      setManualSkuSuggestion("");
      setManualSkuSuggestionPrefix(null);
      setManualSkuSuggestionLoading(false);
      lastManualSuggestionPrefixRef.current = null;
      return;
    }

    const controller = new AbortController();
    manualSkuRequestAbortRef.current = controller;
    setManualSkuSuggestionLoading(true);

    void fetch(`/api/inventory/sku-sequence?piece=${encodeURIComponent(piece)}`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "No se pudo calcular el siguiente SKU");
        }

        const prefix = normalizeManualNomenclaturePrefix((payload?.prefix ?? "").toString());
        if (!prefix.length) {
          throw new Error("No se pudo resolver la nomenclatura de la pieza");
        }

        const nextNumberRaw = Number(payload?.nextNumber ?? NaN);
        const nextNumber = Number.isFinite(nextNumberRaw) && nextNumberRaw > 0 ? Math.trunc(nextNumberRaw) : 1;
        const previousPrefix = lastManualSuggestionPrefixRef.current;
        const prefixChanged = previousPrefix !== prefix;
        if (prefixChanged) {
          setManualSkuEdited(false);
        }
        lastManualSuggestionPrefixRef.current = prefix;
        manualSkuSequenceCacheRef.current.set(prefix, nextNumber);
        setManualSkuSuggestionPrefix(prefix);
        applyManualSkuSuggestion(formatSkuFromPrefixNumber(prefix, nextNumber), prefixChanged);
      })
      .catch((error: any) => {
        if (error?.name === "AbortError") return;
        console.error("No se pudo obtener sugerencia de SKU", error);
        setManualSkuSuggestion("");
        setManualSkuSuggestionPrefix(null);
        lastManualSuggestionPrefixRef.current = null;
        setManualSkuSuggestionError(error?.message || "No se pudo calcular el siguiente SKU");
      })
      .finally(() => {
        if (manualSkuRequestAbortRef.current === controller) {
          manualSkuRequestAbortRef.current = null;
        }
        setManualSkuSuggestionLoading(false);
      });
  }, [applyManualSkuSuggestion, form.pieza, isManualOnly, manualNomenclatureGroups]);

  const createManualNomenclature = useCallback(async () => {
    const prefix = normalizeManualNomenclaturePrefix(manualNomenclaturePrefixDraft);

    if (!prefix.length) {
      setMessage("Captura una nomenclatura valida");
      return;
    }

    setManualNomenclatureLoading(true);
    setManualNomenclatureError(null);

    try {
      const response = await fetch("/api/inventory/nomenclatures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo guardar la nomenclatura");
      }

      const createdId = (payload?.id ?? "").toString();
      setManualNomenclaturePrefixDraft("");
      setMessage("Nomenclatura guardada");
      await fetchManualNomenclatures(createdId || undefined);
    } catch (error: any) {
      console.error("No se pudo guardar la nomenclatura", error);
      setManualNomenclatureError(error?.message || "No se pudo guardar la nomenclatura");
    } finally {
      setManualNomenclatureLoading(false);
    }
  }, [fetchManualNomenclatures, manualNomenclaturePrefixDraft]);

  const addPieceToManualNomenclature = useCallback(async () => {
    const piece = normalizeManualNomenclaturePiece(manualNomenclaturePieceDraft);
    const nomenclatureId = manualNomenclatureSelectedId;

    if (!nomenclatureId) {
      setMessage("Primero selecciona una nomenclatura");
      return;
    }
    if (!piece.length) {
      setMessage("Captura una pieza valida");
      return;
    }

    setManualNomenclatureLoading(true);
    setManualNomenclatureError(null);

    try {
      const response = await fetch("/api/inventory/nomenclatures", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomenclatureId, piece })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo guardar la pieza");
      }

      setManualNomenclaturePieceDraft("");
      setMessage("Pieza asignada a nomenclatura");
      await fetchManualNomenclatures(nomenclatureId);
    } catch (error: any) {
      console.error("No se pudo guardar la pieza", error);
      setManualNomenclatureError(error?.message || "No se pudo guardar la pieza");
    } finally {
      setManualNomenclatureLoading(false);
    }
  }, [fetchManualNomenclatures, manualNomenclaturePieceDraft, manualNomenclatureSelectedId]);

  const removeManualNomenclature = useCallback(async (nomenclatureId: string) => {
    const confirmed = window.confirm("¿Eliminar esta nomenclatura y todas sus piezas?");
    if (!confirmed) return;

    setManualNomenclatureLoading(true);
    setManualNomenclatureError(null);

    try {
      const response = await fetch("/api/inventory/nomenclatures", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomenclatureId })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo eliminar la nomenclatura");
      }

      setMessage("Nomenclatura eliminada");
      const preferredId = manualNomenclatureSelectedId === nomenclatureId ? undefined : manualNomenclatureSelectedId;
      await fetchManualNomenclatures(preferredId);
    } catch (error: any) {
      console.error("No se pudo eliminar la nomenclatura", error);
      setManualNomenclatureError(error?.message || "No se pudo eliminar la nomenclatura");
    } finally {
      setManualNomenclatureLoading(false);
    }
  }, [fetchManualNomenclatures, manualNomenclatureSelectedId]);

  const removeManualNomenclaturePiece = useCallback(async (pieceId: string) => {
    const confirmed = window.confirm("¿Eliminar esta pieza de la nomenclatura?");
    if (!confirmed) return;

    setManualNomenclatureLoading(true);
    setManualNomenclatureError(null);

    try {
      const response = await fetch("/api/inventory/nomenclatures", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pieceId })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo eliminar la pieza");
      }

      setMessage("Pieza eliminada");
      await fetchManualNomenclatures(manualNomenclatureSelectedId || undefined);
    } catch (error: any) {
      console.error("No se pudo eliminar la pieza", error);
      setManualNomenclatureError(error?.message || "No se pudo eliminar la pieza");
    } finally {
      setManualNomenclatureLoading(false);
    }
  }, [fetchManualNomenclatures, manualNomenclatureSelectedId]);

  const anoDesdeNumber = form.anoDesde ? Number(form.anoDesde) : undefined;
  const anoHastaNumber = form.anoHasta ? Number(form.anoHasta) : undefined;
  const activeModalPhoto = modalPhotos[modalActiveIndex] ?? null;
  const { selectedWithMlCount, hasSelectedWithoutMl } = useMemo(() => {
    if (!selectedIds.length) {
      return { selectedWithMlCount: 0, hasSelectedWithoutMl: false };
    }
    const selectedSet = new Set(selectedIds);
    let withMl = 0;
    let withoutMl = 0;
    for (const item of items) {
      if (!selectedSet.has(item.id)) continue;
      if (item.mlItemId && item.mlItemId.trim().length) {
        withMl += 1;
      } else {
        withoutMl += 1;
      }
    }
    return { selectedWithMlCount: withMl, hasSelectedWithoutMl: withoutMl > 0 };
  }, [items, selectedIds]);
  const mlActionDisabled = !canManageMercadoLibre || selectedWithMlCount === 0 || mlAction !== null;

  const toggleItemSelection = useCallback((id: string) => {
    setSelectedIds((current) => {
      if (current.includes(id)) {
        return current.filter((value) => value !== id);
      }
      return [...current, id];
    });
  }, []);

  const updateItemInState = useCallback((id: string, patch: Partial<Item>) => {
    setItems((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  }, []);

  const updateExtraDataInState = useCallback((id: string, patch: Record<string, any>) => {
    setItems((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              extraData: {
                ...(row.extraData ?? {}),
                ...patch
              }
            }
          : row
      )
    );
  }, []);

  const getItemYearLabel = useCallback((item: Item) => {
    const extra = item.extraData ?? {};
    const hasYear = extra.ano_desde || extra.ano_hasta;
    return hasYear ? `${extra.ano_desde ?? "-"}-${extra.ano_hasta ?? "-"}` : "-";
  }, []);

  const getItemPieceName = useCallback((item: Item) => {
    const extra = item.extraData ?? {};
    const hasYear = extra.ano_desde || extra.ano_hasta;
    const yearSegment = hasYear
      ? extra.ano_desde && extra.ano_hasta && extra.ano_desde !== extra.ano_hasta
        ? `${extra.ano_desde}-${extra.ano_hasta}`
        : extra.ano_desde ?? extra.ano_hasta
      : "";
    const parts = [extra.pieza, extra.marca, extra.coche, yearSegment, item.skuInternal]
      .map((part) => (part ?? "").toString().trim())
      .filter((part) => part.length);
    return parts.length ? parts.join(" ") : item.title || "-";
  }, []);

  const toggleSort = useCallback((key: SortKey) => {
    setSortConfig((current) => {
      if (!current || current.key !== key) {
        return { key, direction: "asc" };
      }
      if (current.direction === "asc") {
        return { key, direction: "desc" };
      }
      return null;
    });
  }, []);

  const getSortIndicator = useCallback(
    (key: SortKey) => {
      if (!sortConfig || sortConfig.key !== key) return "↕";
      return sortConfig.direction === "asc" ? "↑" : "↓";
    },
    [sortConfig]
  );

  const handleEstatusInternoChange = useCallback(
    (item: Item, nextValue: string) => {
      if (!canEditInventory) return;
      const val = nextValue.toString().trim().toUpperCase();
      const currentBuyer = (item.extraData?.prestado_vendido_a ?? "").toString();
      let overrideBuyer: string | null | undefined = undefined;
      let overridePrice: number | null | undefined = undefined;

      if (val === "VENDIDO" || val === "PRESTADO") {
        const question = val === "VENDIDO" ? "¿A quien se vendio?" : "¿A quien se presto?";
        const errorText = val === "VENDIDO" ? "Debes indicar a quien se vendio" : "Debes indicar a quien se presto";
        const response = window.prompt(question, currentBuyer);
        if (response === null) {
          setMessage("Actualizacion cancelada");
          return;
        }
        const cleaned = response.trim();
        if (!cleaned.length) {
          setMessage(errorText);
          return;
        }
        overrideBuyer = cleaned.toUpperCase();

        const defaultAmountText =
          item.price !== null &&
          item.price !== undefined &&
          Number.isFinite(item.price) &&
          item.price > 0
            ? String(item.price)
            : "";
        const amountQuestion =
          val === "VENDIDO" ? "¿En cuánto se vendió la pieza?" : "¿En cuánto se prestó la pieza?";
        const amountAnswer = window.prompt(
          `${amountQuestion}\nEse costo también se guardará como precio.`,
          defaultAmountText
        );
        if (amountAnswer === null) {
          setMessage("Actualizacion cancelada");
          return;
        }

        const parsedAmount = parsePositiveAmountInput(amountAnswer);
        if (!parsedAmount) {
          setMessage("Debes indicar un costo valido para prestar o vender");
          return;
        }
        overridePrice = parsedAmount;
      }

      updateExtraDataInState(item.id, {
        estatus_interno: val || undefined,
        ...(overrideBuyer !== undefined ? { prestado_vendido_a: overrideBuyer || undefined } : {})
      });
      updateEstatusInterno(item.id, val, overrideBuyer, overridePrice);
    },
    [canEditInventory, updateEstatusInterno, updateExtraDataInState]
  );

  const handleOrigenChange = useCallback(
    (item: Item, nextValue: string) => {
      if (!canEditInventory) return;
      const val = nextValue.toString().trim().toUpperCase();
      updateExtraDataInState(item.id, { origen: val || undefined });
      updateOrigen(item.id, val);
    },
    [canEditInventory, updateExtraDataInState, updateOrigen]
  );

  const handleUbicacionBlur = useCallback(
    (item: Item, rawValue: string) => {
      if (!canEditInventory) return;
      const val = rawValue.toString().trim().toUpperCase();
      updateExtraDataInState(item.id, { ubicacion: val || undefined });
      updateUbicacion(item.id, val);
    },
    [canEditInventory, updateExtraDataInState, updateUbicacion]
  );

  const handleMlItemBlur = useCallback(
    (item: Item, rawValue: string) => {
      if (!canEditInventory) return;
      const val = rawValue.toString().trim();
      updateItemInState(item.id, { mlItemId: val || null });
      updateMlItemId(item.id, val);
    },
    [canEditInventory, updateItemInState, updateMlItemId]
  );

  const handlePriceBlur = useCallback(
    (item: Item, rawValue: string) => {
      if (!canEditInventory) return;
      const trimmed = rawValue.toString().replace(/[$,\s]/g, "").trim();
      if (!trimmed.length) {
        updateItemInState(item.id, { price: null });
        updatePrice(item.id, null);
        return;
      }
      const priceValue = Number(trimmed);
      if (Number.isNaN(priceValue) || priceValue < 0) {
        setMessage("Precio invalido");
        return;
      }
      updateItemInState(item.id, { price: priceValue });
      updatePrice(item.id, priceValue);
    },
    [canEditInventory, updateItemInState, updatePrice]
  );

  const handleSkuBlur = useCallback(
    async (item: Item, rawValue: string) => {
      if (!canEditInventory) return;
      const trimmed = rawValue.toString().trim().toUpperCase();
      if (!trimmed.length) {
        setMessage("SKU invalido");
        return;
      }
      const prevValue = item.skuInternal;
      updateItemInState(item.id, { skuInternal: trimmed });
      try {
        const res = await fetch("/api/inventory", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, skuInternal: trimmed })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "No se pudo actualizar el SKU");
        }
      } catch (err: any) {
        updateItemInState(item.id, { skuInternal: prevValue });
        setMessage(err?.message || "No se pudo actualizar el SKU");
      }
    },
    [canEditInventory, updateItemInState]
  );

  const handleMarcaBlur = useCallback(
    async (item: Item, rawValue: string) => {
      if (!canEditInventory) return;
      const trimmed = rawValue.toString().trim().toUpperCase();
      updateExtraDataInState(item.id, { marca: trimmed || undefined });
      try {
        const res = await fetch("/api/inventory", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, marca: trimmed || null })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "No se pudo actualizar la marca");
        }
      } catch (err: any) {
        setMessage(err?.message || "No se pudo actualizar la marca");
      }
    },
    [canEditInventory, updateExtraDataInState]
  );

  const handleCocheBlur = useCallback(
    async (item: Item, rawValue: string) => {
      if (!canEditInventory) return;
      const trimmed = rawValue.toString().trim().toUpperCase();
      updateExtraDataInState(item.id, { coche: trimmed || undefined });
      try {
        const res = await fetch("/api/inventory", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, coche: trimmed || null })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "No se pudo actualizar el coche");
        }
      } catch (err: any) {
        setMessage(err?.message || "No se pudo actualizar el coche");
      }
    },
    [canEditInventory, updateExtraDataInState]
  );

  const handleAnoBlur = useCallback(
    async (item: Item, rawValue: string) => {
      if (!canEditInventory) return;
      const normalized = rawValue.toString().trim();
      if (!normalized.length) {
        updateExtraDataInState(item.id, { ano_desde: undefined, ano_hasta: undefined });
        try {
          await fetch("/api/inventory", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: item.id, anoDesde: null, anoHasta: null })
          });
        } catch (err: any) {
          setMessage(err?.message || "No se pudo actualizar el año");
        }
        return;
      }

      const match = normalized.match(/(\d{2,4})(?:\D+(\d{2,4}))?/);
      const from = match?.[1] ? match[1] : normalized;
      const to = match?.[2] ? match[2] : match?.[1] ?? normalized;
      updateExtraDataInState(item.id, { ano_desde: from, ano_hasta: to });

      try {
        const res = await fetch("/api/inventory", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, anoDesde: from, anoHasta: to })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "No se pudo actualizar el año");
        }
      } catch (err: any) {
        setMessage(err?.message || "No se pudo actualizar el año");
      }
    },
    [canEditInventory, updateExtraDataInState]
  );

  const openInventoryEditModal = useCallback((item: Item) => {
    const extra = item.extraData ?? {};
    const toText = (value: unknown) => (value === null || value === undefined ? "" : String(value));
    setInventoryEditError(null);
    setInventoryEditForm({
      id: item.id,
      skuInternal: toText(item.skuInternal).toUpperCase(),
      mlItemId: toText(item.mlItemId).toUpperCase(),
      estatusInterno: toText(extra.estatus_interno).toUpperCase(),
      stock: Number.isFinite(item.stock as number) ? String(item.stock) : "0",
      pieza: toText(extra.pieza).toUpperCase(),
      marca: toText(extra.marca).toUpperCase(),
      coche: toText(extra.coche).toUpperCase(),
      anoDesde: toText(extra.ano_desde),
      anoHasta: toText(extra.ano_hasta),
      origen: toText(extra.origen).toUpperCase(),
      price: item.price === null || item.price === undefined ? "" : String(item.price),
      precioCompra: extra.precio_compra === null || extra.precio_compra === undefined ? "" : String(extra.precio_compra),
      ubicacion: toText(extra.ubicacion).toUpperCase(),
      prestadoVendidoA: toText(extra.prestado_vendido_a).toUpperCase()
    });
  }, []);

  const closeInventoryEditModal = useCallback(() => {
    if (inventoryEditSaving) return;
    setInventoryEditForm(null);
    setInventoryEditError(null);
  }, [inventoryEditSaving]);

  const handleInventoryEditFieldChange = useCallback(
    (field: keyof InventoryEditFormState, value: string) => {
      setInventoryEditForm((current) => {
        if (!current) return current;
        return { ...current, [field]: value };
      });
    },
    []
  );

  const saveInventoryEditModal = useCallback(async () => {
    if (!inventoryEditForm) return;
    if (!canEditInventory) {
      setInventoryEditError("Tu rol no puede editar inventario");
      return;
    }

    const skuInternal = inventoryEditForm.skuInternal.trim().toUpperCase();
    if (!skuInternal) {
      setInventoryEditError("SKU interno es obligatorio");
      return;
    }

    const mlItemId = inventoryEditForm.mlItemId.trim().toUpperCase();
    const estatusInterno = inventoryEditForm.estatusInterno.trim().toUpperCase();
    const origen = inventoryEditForm.origen.trim().toUpperCase();
    const pieza = inventoryEditForm.pieza.trim().toUpperCase();
    const marca = inventoryEditForm.marca.trim().toUpperCase();
    const coche = inventoryEditForm.coche.trim().toUpperCase();
    const ubicacion = inventoryEditForm.ubicacion.trim().toUpperCase();
    const prestadoVendidoA = inventoryEditForm.prestadoVendidoA.trim().toUpperCase();
    const anoDesde = inventoryEditForm.anoDesde.trim();
    const anoHasta = inventoryEditForm.anoHasta.trim();

    if ((estatusInterno === "VENDIDO" || estatusInterno === "PRESTADO") && !prestadoVendidoA) {
      setInventoryEditError(
        estatusInterno === "VENDIDO" ? "Debes indicar a quien se vendio" : "Debes indicar a quien se presto"
      );
      return;
    }

    const stockRaw = inventoryEditForm.stock.trim();
    const stockValue = stockRaw.length ? Number(stockRaw) : 0;
    if (!Number.isInteger(stockValue) || stockValue < 0) {
      setInventoryEditError("Stock invalido");
      return;
    }

    const priceRaw = inventoryEditForm.price.replace(/[$,\s]/g, "").trim();
    let priceValue = priceRaw.length ? Number(priceRaw) : null;
    if (priceValue !== null && (!Number.isFinite(priceValue) || priceValue < 0)) {
      setInventoryEditError("Precio invalido");
      return;
    }

    if (estatusInterno === "VENDIDO" || estatusInterno === "PRESTADO") {
      const defaultAmountText =
        priceValue !== null &&
        priceValue !== undefined &&
        Number.isFinite(priceValue) &&
        priceValue > 0
          ? String(priceValue)
          : "";
      const amountQuestion =
        estatusInterno === "VENDIDO" ? "¿En cuánto se vendió la pieza?" : "¿En cuánto se prestó la pieza?";
      const amountAnswer = window.prompt(
        `${amountQuestion}\nEse costo también se guardará como precio.`,
        defaultAmountText
      );
      if (amountAnswer === null) {
        setInventoryEditError("Actualizacion cancelada");
        return;
      }

      const parsedAmount = parsePositiveAmountInput(amountAnswer);
      if (!parsedAmount) {
        setInventoryEditError("Debes indicar un costo valido para prestar o vender");
        return;
      }

      priceValue = parsedAmount;
      setInventoryEditForm((current) => (current ? { ...current, price: String(parsedAmount) } : current));
    }

    const precioCompraRaw = inventoryEditForm.precioCompra.replace(/[$,\s]/g, "").trim();
    const precioCompraValue = precioCompraRaw.length ? Number(precioCompraRaw) : null;
    if (precioCompraValue !== null && (!Number.isFinite(precioCompraValue) || precioCompraValue < 0)) {
      setInventoryEditError("Precio de compra invalido");
      return;
    }

    if (!mlItemId && (estatusInterno === "PRESTADO" || estatusInterno === "ML")) {
      setMessage("Este registro no tiene código de Mercado Libre; se guardará el estatus interno sin sincronizar.");
    }

    const nextStatus =
      estatusInterno === "VENDIDO" || estatusInterno === "SIN SUBIR"
        ? "inactive"
        : estatusInterno === "PRESTADO"
        ? mlItemId
          ? "paused"
          : undefined
        : estatusInterno === "ML"
        ? mlItemId
          ? "active"
          : undefined
        : undefined;

    const shouldStampDate = estatusInterno === "PRESTADO" || estatusInterno === "VENDIDO";
    const fechaPrestamoPago = shouldStampDate ? new Date().toISOString() : null;

    setInventoryEditSaving(true);
    setInventoryEditError(null);

    try {
      const res = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: inventoryEditForm.id,
          skuInternal,
          mlItemId: mlItemId || null,
          estatusInterno: estatusInterno || null,
          status: nextStatus,
          forceMlSync: estatusInterno === "ML",
          fechaPrestamoPago,
          prestadoVendidoA: prestadoVendidoA || null,
          origen: origen || null,
          ubicacion: ubicacion || null,
          marca: marca || null,
          coche: coche || null,
          anoDesde: anoDesde || null,
          anoHasta: anoHasta || null,
          pieza: pieza || null,
          stock: stockValue,
          price: priceValue,
          precioCompra: precioCompraValue
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "No se pudo actualizar el registro");
      }

      const { mlSyncError, ...updatedItem } = data as Record<string, any>;
      setItems((current) =>
        current.map((row) => (row.id === inventoryEditForm.id ? { ...row, ...(updatedItem as Partial<Item>) } : row))
      );

      let financeResult: SoldFinanceRegistrationResult = { status: "skipped" };
      if (estatusInterno === "VENDIDO") {
        const pieceForFinance =
          pieza ||
          (updatedItem?.extraData && typeof updatedItem.extraData === "object"
            ? String((updatedItem.extraData as Record<string, unknown>).pieza ?? "")
            : "") ||
          String(updatedItem?.title ?? "") ||
          "PIEZA VENDIDA";

        financeResult = await registerSoldItemInFinance({
          piece: pieceForFinance,
          skuInternal,
          defaultAmount: priceValue ?? (typeof updatedItem?.price === "number" ? updatedItem.price : null),
          saleDate: fechaPrestamoPago
        });
      }

      const financeMessage =
        financeResult.status === "registered"
          ? financeResult.entryType === "income"
            ? " y registrada en ingresos"
            : " y registrada en egresos"
          : "";

      setMessage(
        mlSyncError
          ? `Registro actualizado${financeMessage}, pero ML falló: ${mlSyncError}`
          : financeResult.status === "failed"
          ? financeResult.message
          : `Registro actualizado${financeMessage}`
      );

      setInventoryEditForm(null);
    } catch (err: any) {
      setInventoryEditError(err?.message || "No se pudo actualizar el registro");
    } finally {
      setInventoryEditSaving(false);
    }
  }, [canEditInventory, inventoryEditForm, registerSoldItemInFinance]);

  const deferredSearch = useDeferredValue(search);
  const serverSearchTerm = deferredSearch.trim();
  const normalizedSearch = serverSearchTerm.toLowerCase();
  const canUseWorkerSearch = !useServerPagination && items.length >= WORKER_SEARCH_MIN_ITEMS;

  useEffect(() => {
    if (!useServerPagination) {
      setDebouncedServerSearchTerm(serverSearchTerm);
      return;
    }

    const timeout = setTimeout(() => {
      setDebouncedServerSearchTerm(serverSearchTerm);
    }, SERVER_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [serverSearchTerm, useServerPagination]);

  useEffect(() => {
    const worker = searchWorkerRef.current;
    if (!worker || !canUseWorkerSearch) {
      setWorkerSearchResult(null);
      setWorkerSearching(false);
      return;
    }

    const payload: InventorySearchIndexMessage = {
      type: "index",
      items
    };
    worker.postMessage(payload);
  }, [canUseWorkerSearch, items]);

  useEffect(() => {
    const worker = searchWorkerRef.current;
    if (!worker || !canUseWorkerSearch) return;

    if (!normalizedSearch.length) {
      setWorkerSearchResult(null);
      setWorkerSearching(false);
      return;
    }

    const requestId = workerSearchRequestIdRef.current + 1;
    workerSearchRequestIdRef.current = requestId;
    setWorkerSearching(true);

    const payload: InventorySearchQueryMessage = {
      type: "search",
      query: normalizedSearch,
      requestId
    };
    worker.postMessage(payload);
  }, [canUseWorkerSearch, items, normalizedSearch]);

  const itemById = useMemo(() => {
    return new Map(items.map((item) => [item.id, item]));
  }, [items]);

  const fallbackSearchFilteredItems = useMemo(() => {
    if (!normalizedSearch.length) return items;
    return items.filter((item) => buildInventorySearchText(item).includes(normalizedSearch));
  }, [items, normalizedSearch]);

  const searchFilteredItems = useMemo(() => {
    if (useServerPagination) return items;
    if (!normalizedSearch.length) return items;

    if (canUseWorkerSearch) {
      if (!workerSearchResult || workerSearchResult.query !== normalizedSearch) {
        return [];
      }

      return workerSearchResult.ids
        .map((id) => itemById.get(id))
        .filter((item): item is Item => Boolean(item));
    }

    return fallbackSearchFilteredItems;
  }, [items, normalizedSearch, canUseWorkerSearch, workerSearchResult, itemById, fallbackSearchFilteredItems, useServerPagination]);

  const workerSearchPending =
    !useServerPagination && canUseWorkerSearch && normalizedSearch.length > 0 && (workerSearching || !workerSearchResult || workerSearchResult.query !== normalizedSearch);

  const normalizedStatusFilter = statusFilter?.toUpperCase() ?? null;
  const normalizedInventoryMarcaFilter = inventoryMarcaFilter.trim().toUpperCase();
  const normalizedInventoryCocheFilter = inventoryCocheFilter.trim().toUpperCase();
  const normalizedInventoryPiezaFilter = inventoryPiezaFilter.trim().toUpperCase();
  const normalizedPrestadoDebtorFilters = useMemo(
    () =>
      Array.from(
        new Set(
          prestadoDebtorFilters
            .map((value) => value.trim().toUpperCase())
            .filter((value) => value.length)
        )
      ).sort((a, b) => a.localeCompare(b, "es")),
    [prestadoDebtorFilters]
  );
  const normalizedPrestadoDebtorFilterSet = useMemo(
    () => new Set(normalizedPrestadoDebtorFilters),
    [normalizedPrestadoDebtorFilters]
  );

  useEffect(() => {
    if (normalizedStatusFilter === "PRESTADO") return;
    if (!prestadoDebtorFilters.length) return;
    setPrestadoDebtorFilters([]);
  }, [normalizedStatusFilter, prestadoDebtorFilters]);

  useEffect(() => {
    if (!useServerPagination) return;

    void fetchInventoryPage({
      page: inventoryPage,
      search: debouncedServerSearchTerm,
      statusFilter: normalizedStatusFilter,
      marcaFilter: normalizedInventoryMarcaFilter,
      cocheFilter: normalizedInventoryCocheFilter,
      piezaFilter: normalizedInventoryPiezaFilter,
      prestadoDebtorFilters: normalizedStatusFilter === "PRESTADO" ? normalizedPrestadoDebtorFilters : [],
      includeFacetOptions: inventoryPage === 1,
      preserveSelection: false
    });
  }, [
    fetchInventoryPage,
    inventoryPage,
    inventoryReloadSeq,
    normalizedInventoryCocheFilter,
    normalizedInventoryMarcaFilter,
    normalizedInventoryPiezaFilter,
    normalizedPrestadoDebtorFilters,
    normalizedStatusFilter,
    debouncedServerSearchTerm,
    useServerPagination
  ]);

  const statusAndSearchFilteredItems = useMemo(() => {
    if (useServerPagination) return items;
    if (!normalizedStatusFilter) return searchFilteredItems;
    return searchFilteredItems.filter((item) => {
      const current = (item.extraData?.estatus_interno ?? "").toString().trim().toUpperCase();
      const label = current.length ? current : "SIN ESTATUS";
      return label === normalizedStatusFilter;
    });
  }, [items, searchFilteredItems, normalizedStatusFilter, useServerPagination]);

  const getInventoryFacetMarca = useCallback((item: Item) => normalizeFacetValue(item.extraData?.marca), []);
  const getInventoryFacetCoche = useCallback((item: Item) => normalizeFacetValue(item.extraData?.coche), []);
  const getInventoryFacetPieza = useCallback((item: Item) => {
    const pieceFromExtra = normalizeFacetValue(item.extraData?.pieza);
    if (pieceFromExtra.length) return pieceFromExtra;
    return normalizeFacetValue(item.title);
  }, []);
  const getInventoryFacetPrestadoDebtor = useCallback(
    (item: Item) => normalizeFacetValue(item.extraData?.prestado_vendido_a),
    []
  );

  const inventoryMarcaOptions = useMemo(() => {
    if (useServerPagination) {
      const base = serverFacetOptions.marca;
      if (!normalizedInventoryMarcaFilter) return base;
      return Array.from(new Set([normalizedInventoryMarcaFilter, ...base])).sort((a, b) => a.localeCompare(b, "es"));
    }

    const options = statusAndSearchFilteredItems
      .filter((item) => {
        const cocheValue = getInventoryFacetCoche(item);
        const piezaValue = getInventoryFacetPieza(item);
        const prestadoDebtorValue = getInventoryFacetPrestadoDebtor(item);
        const matchesCoche = !normalizedInventoryCocheFilter || cocheValue === normalizedInventoryCocheFilter;
        const matchesPieza = !normalizedInventoryPiezaFilter || piezaValue === normalizedInventoryPiezaFilter;
        const matchesPrestadoDebtor =
          normalizedStatusFilter !== "PRESTADO" ||
          normalizedPrestadoDebtorFilterSet.size === 0 ||
          normalizedPrestadoDebtorFilterSet.has(prestadoDebtorValue);
        return matchesCoche && matchesPieza && matchesPrestadoDebtor;
      })
      .map(getInventoryFacetMarca)
      .filter((value) => value.length);

    return Array.from(new Set(options)).sort((a, b) => a.localeCompare(b, "es"));
  }, [
    useServerPagination,
    serverFacetOptions.marca,
    normalizedInventoryMarcaFilter,
    statusAndSearchFilteredItems,
    normalizedInventoryCocheFilter,
    normalizedInventoryPiezaFilter,
    normalizedStatusFilter,
    normalizedPrestadoDebtorFilterSet,
    getInventoryFacetMarca,
    getInventoryFacetCoche,
    getInventoryFacetPieza,
    getInventoryFacetPrestadoDebtor
  ]);

  const inventoryCocheOptions = useMemo(() => {
    if (useServerPagination) {
      const base = serverFacetOptions.coche;
      if (!normalizedInventoryCocheFilter) return base;
      return Array.from(new Set([normalizedInventoryCocheFilter, ...base])).sort((a, b) => a.localeCompare(b, "es"));
    }

    const options = statusAndSearchFilteredItems
      .filter((item) => {
        const marcaValue = getInventoryFacetMarca(item);
        const piezaValue = getInventoryFacetPieza(item);
        const prestadoDebtorValue = getInventoryFacetPrestadoDebtor(item);
        const matchesMarca = !normalizedInventoryMarcaFilter || marcaValue === normalizedInventoryMarcaFilter;
        const matchesPieza = !normalizedInventoryPiezaFilter || piezaValue === normalizedInventoryPiezaFilter;
        const matchesPrestadoDebtor =
          normalizedStatusFilter !== "PRESTADO" ||
          normalizedPrestadoDebtorFilterSet.size === 0 ||
          normalizedPrestadoDebtorFilterSet.has(prestadoDebtorValue);
        return matchesMarca && matchesPieza && matchesPrestadoDebtor;
      })
      .map(getInventoryFacetCoche)
      .filter((value) => value.length);

    return Array.from(new Set(options)).sort((a, b) => a.localeCompare(b, "es"));
  }, [
    useServerPagination,
    serverFacetOptions.coche,
    normalizedInventoryCocheFilter,
    statusAndSearchFilteredItems,
    normalizedInventoryMarcaFilter,
    normalizedInventoryPiezaFilter,
    normalizedStatusFilter,
    normalizedPrestadoDebtorFilterSet,
    getInventoryFacetMarca,
    getInventoryFacetCoche,
    getInventoryFacetPieza,
    getInventoryFacetPrestadoDebtor
  ]);

  const inventoryPiezaOptions = useMemo(() => {
    if (useServerPagination) {
      const base = serverFacetOptions.pieza;
      if (!normalizedInventoryPiezaFilter) return base;
      return Array.from(new Set([normalizedInventoryPiezaFilter, ...base])).sort((a, b) => a.localeCompare(b, "es"));
    }

    const options = statusAndSearchFilteredItems
      .filter((item) => {
        const marcaValue = getInventoryFacetMarca(item);
        const cocheValue = getInventoryFacetCoche(item);
        const prestadoDebtorValue = getInventoryFacetPrestadoDebtor(item);
        const matchesMarca = !normalizedInventoryMarcaFilter || marcaValue === normalizedInventoryMarcaFilter;
        const matchesCoche = !normalizedInventoryCocheFilter || cocheValue === normalizedInventoryCocheFilter;
        const matchesPrestadoDebtor =
          normalizedStatusFilter !== "PRESTADO" ||
          normalizedPrestadoDebtorFilterSet.size === 0 ||
          normalizedPrestadoDebtorFilterSet.has(prestadoDebtorValue);
        return matchesMarca && matchesCoche && matchesPrestadoDebtor;
      })
      .map(getInventoryFacetPieza)
      .filter((value) => value.length);

    return Array.from(new Set(options)).sort((a, b) => a.localeCompare(b, "es"));
  }, [
    useServerPagination,
    serverFacetOptions.pieza,
    normalizedInventoryPiezaFilter,
    statusAndSearchFilteredItems,
    normalizedInventoryMarcaFilter,
    normalizedInventoryCocheFilter,
    normalizedStatusFilter,
    normalizedPrestadoDebtorFilterSet,
    getInventoryFacetMarca,
    getInventoryFacetCoche,
    getInventoryFacetPieza,
    getInventoryFacetPrestadoDebtor
  ]);

  const inventoryPrestadoDebtorOptions = useMemo(() => {
    if (normalizedStatusFilter !== "PRESTADO") return [];

    if (useServerPagination) {
      const base = serverFacetOptions.prestadoDebtor;
      if (!normalizedPrestadoDebtorFilters.length) return base;
      return Array.from(new Set([...normalizedPrestadoDebtorFilters, ...base])).sort((a, b) =>
        a.localeCompare(b, "es")
      );
    }

    const options = statusAndSearchFilteredItems
      .filter((item) => {
        const marcaValue = getInventoryFacetMarca(item);
        const cocheValue = getInventoryFacetCoche(item);
        const piezaValue = getInventoryFacetPieza(item);
        const matchesMarca = !normalizedInventoryMarcaFilter || marcaValue === normalizedInventoryMarcaFilter;
        const matchesCoche = !normalizedInventoryCocheFilter || cocheValue === normalizedInventoryCocheFilter;
        const matchesPieza = !normalizedInventoryPiezaFilter || piezaValue === normalizedInventoryPiezaFilter;
        return matchesMarca && matchesCoche && matchesPieza;
      })
      .map(getInventoryFacetPrestadoDebtor)
      .filter((value) => value.length);

    return Array.from(new Set(options)).sort((a, b) => a.localeCompare(b, "es"));
  }, [
    useServerPagination,
    serverFacetOptions.prestadoDebtor,
    normalizedPrestadoDebtorFilters,
    statusAndSearchFilteredItems,
    normalizedStatusFilter,
    normalizedInventoryMarcaFilter,
    normalizedInventoryCocheFilter,
    normalizedInventoryPiezaFilter,
    getInventoryFacetMarca,
    getInventoryFacetCoche,
    getInventoryFacetPieza,
    getInventoryFacetPrestadoDebtor
  ]);

  const visiblePrestadoDebtorOptions = useMemo(() => {
    if (normalizedStatusFilter !== "PRESTADO") return [];
    return Array.from(new Set([...inventoryPrestadoDebtorOptions, ...normalizedPrestadoDebtorFilters])).sort((a, b) =>
      a.localeCompare(b, "es")
    );
  }, [inventoryPrestadoDebtorOptions, normalizedPrestadoDebtorFilters, normalizedStatusFilter]);

  const togglePrestadoDebtorFilter = useCallback((debtor: string) => {
    const normalized = debtor.trim().toUpperCase();
    if (!normalized.length) return;

    setPrestadoDebtorFilters((current) => {
      const exists = current.some((entry) => entry.trim().toUpperCase() === normalized);
      if (exists) {
        return current.filter((entry) => entry.trim().toUpperCase() !== normalized);
      }
      return [...current, normalized];
    });
  }, []);

  useEffect(() => {
    if (useServerPagination) return;
    if (!inventoryMarcaFilter) return;
    if (!inventoryMarcaOptions.includes(inventoryMarcaFilter)) {
      setInventoryMarcaFilter("");
    }
  }, [inventoryMarcaFilter, inventoryMarcaOptions, useServerPagination]);

  useEffect(() => {
    if (useServerPagination) return;
    if (!inventoryCocheFilter) return;
    if (!inventoryCocheOptions.includes(inventoryCocheFilter)) {
      setInventoryCocheFilter("");
    }
  }, [inventoryCocheFilter, inventoryCocheOptions, useServerPagination]);

  useEffect(() => {
    if (useServerPagination) return;
    if (!inventoryPiezaFilter) return;
    if (!inventoryPiezaOptions.includes(inventoryPiezaFilter)) {
      setInventoryPiezaFilter("");
    }
  }, [inventoryPiezaFilter, inventoryPiezaOptions, useServerPagination]);

  const facetedFilteredItems = useMemo(() => {
    if (useServerPagination) return statusAndSearchFilteredItems;
    return statusAndSearchFilteredItems.filter((item) => {
      const marcaValue = getInventoryFacetMarca(item);
      const cocheValue = getInventoryFacetCoche(item);
      const piezaValue = getInventoryFacetPieza(item);

      if (normalizedInventoryMarcaFilter && marcaValue !== normalizedInventoryMarcaFilter) return false;
      if (normalizedInventoryCocheFilter && cocheValue !== normalizedInventoryCocheFilter) return false;
      if (normalizedInventoryPiezaFilter && piezaValue !== normalizedInventoryPiezaFilter) return false;
      if (
        normalizedStatusFilter === "PRESTADO" &&
        normalizedPrestadoDebtorFilterSet.size > 0 &&
        !normalizedPrestadoDebtorFilterSet.has(getInventoryFacetPrestadoDebtor(item))
      ) {
        return false;
      }

      return true;
    });
  }, [
    statusAndSearchFilteredItems,
    normalizedInventoryMarcaFilter,
    normalizedInventoryCocheFilter,
    normalizedInventoryPiezaFilter,
    normalizedStatusFilter,
    normalizedPrestadoDebtorFilterSet,
    getInventoryFacetMarca,
    getInventoryFacetCoche,
    getInventoryFacetPieza,
    getInventoryFacetPrestadoDebtor,
    useServerPagination
  ]);

  const filteredItems = useMemo(() => {
    const filtered = facetedFilteredItems;

    if (!sortConfig) return filtered;

    const sorted = [...filtered].sort((a, b) => {
      const extraA = a.extraData ?? {};
      const extraB = b.extraData ?? {};
      const direction = sortConfig.direction === "asc" ? 1 : -1;
      let left = "";
      let right = "";
      let numericCompare = false;

      switch (sortConfig.key) {
        case "estatusInterno":
          left = ((extraA.estatus_interno ?? "").toString().trim() || "SIN ESTATUS").toLowerCase();
          right = ((extraB.estatus_interno ?? "").toString().trim() || "SIN ESTATUS").toLowerCase();
          break;
        case "pieza":
          left = getItemPieceName(a).toLowerCase();
          right = getItemPieceName(b).toLowerCase();
          break;
        case "sku":
          left = (a.skuInternal ?? "").toString().toLowerCase();
          right = (b.skuInternal ?? "").toString().toLowerCase();
          break;
        case "status":
          left = (a.status ?? "").toString().toLowerCase();
          right = (b.status ?? "").toString().toLowerCase();
          break;
        case "marca":
          left = (extraA.marca ?? "").toString().toLowerCase();
          right = (extraB.marca ?? "").toString().toLowerCase();
          break;
        case "coche":
          left = (extraA.coche ?? "").toString().toLowerCase();
          right = (extraB.coche ?? "").toString().toLowerCase();
          break;
        case "ano":
          left = getItemYearLabel(a).toLowerCase();
          right = getItemYearLabel(b).toLowerCase();
          break;
        case "precio":
          numericCompare = true;
          break;
      }

      if (numericCompare) {
        const leftNum = a.price ?? 0;
        const rightNum = b.price ?? 0;
        return (leftNum - rightNum) * direction;
      }

      if (left === right) return 0;
      return left.localeCompare(right, "es") * direction;
    });

    return sorted;
  }, [facetedFilteredItems, sortConfig, getItemPieceName, getItemYearLabel]);

  const filteredTotalPages = useMemo(() => {
    if (useServerPagination) {
      return Math.max(1, Math.ceil(totalItems / INVENTORY_PAGE_BLOCK_SIZE));
    }
    return Math.max(1, Math.ceil(filteredItems.length / INVENTORY_PAGE_BLOCK_SIZE));
  }, [filteredItems.length, totalItems, useServerPagination]);

  useEffect(() => {
    setInventoryPage(1);
  }, [
    normalizedSearch,
    normalizedStatusFilter,
    normalizedInventoryMarcaFilter,
    normalizedInventoryCocheFilter,
    normalizedInventoryPiezaFilter,
    normalizedPrestadoDebtorFilters
  ]);

  useEffect(() => {
    if (inventoryPage <= filteredTotalPages) return;
    setInventoryPage(filteredTotalPages);
  }, [filteredTotalPages, inventoryPage]);

  const paginatedFilteredItems = useMemo(() => {
    if (useServerPagination) return filteredItems;
    const start = (inventoryPage - 1) * INVENTORY_PAGE_BLOCK_SIZE;
    return filteredItems.slice(start, start + INVENTORY_PAGE_BLOCK_SIZE);
  }, [filteredItems, inventoryPage, useServerPagination]);
  const shouldVirtualizeDesktop = paginatedFilteredItems.length > 120;

  const visibleBaseTotal = useServerPagination ? totalItems : filteredItems.length;
  const paginatedVisibleStart = visibleBaseTotal
    ? (inventoryPage - 1) * INVENTORY_PAGE_BLOCK_SIZE + 1
    : 0;
  const paginatedVisibleEnd = Math.min(inventoryPage * INVENTORY_PAGE_BLOCK_SIZE, visibleBaseTotal);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const virtualizedDesktopRows = useMemo(() => {
    const totalRows = paginatedFilteredItems.length;
    if (!totalRows) {
      return {
        rows: [] as Item[],
        topSpacerHeight: 0,
        bottomSpacerHeight: 0
      };
    }

    if (!shouldVirtualizeDesktop) {
      return {
        rows: paginatedFilteredItems,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0
      };
    }

    const startIndex = Math.max(0, tableScrollRowStart - TABLE_OVERSCAN_ROWS);
    const visibleRows = Math.ceil(tableViewportHeight / tableRowHeight) + TABLE_OVERSCAN_ROWS * 2;
    const endIndex = Math.min(totalRows, startIndex + visibleRows);

    return {
      rows: paginatedFilteredItems.slice(startIndex, endIndex),
      topSpacerHeight: startIndex * tableRowHeight,
      bottomSpacerHeight: Math.max(0, (totalRows - endIndex) * tableRowHeight)
    };
  }, [paginatedFilteredItems, shouldVirtualizeDesktop, tableRowHeight, tableScrollRowStart, tableViewportHeight]);

  useEffect(() => {
    if (isMobile) return;
    const container = desktopTableContainerRef.current;
    if (!container) return;
    container.scrollTop = 0;
    setTableScrollRowStart(0);
  }, [
    isMobile,
    normalizedSearch,
    normalizedStatusFilter,
    normalizedInventoryMarcaFilter,
    normalizedInventoryCocheFilter,
    normalizedInventoryPiezaFilter,
    normalizedPrestadoDebtorFilters,
    sortConfig,
    inventoryPage
  ]);

  const statusCounters = useMemo(() => {
    const localCounts: Record<string, number> = {};
    items.forEach((item) => {
      const key = normalizeStatusLabel(item.extraData?.estatus_interno);
      localCounts[key] = (localCounts[key] ?? 0) + 1;
    });

    const useServerTotals = Object.keys(statusTotals).length > 0 && items.length < totalItems;
    const source = useServerTotals ? statusTotals : localCounts;
    return Object.entries(source).sort((a, b) => {
      if (a[1] === b[1]) {
        return a[0].localeCompare(b[0]);
      }
      return b[1] - a[1];
    });
  }, [items, statusTotals, totalItems]);

  const prestadoSummary = useMemo(() => {
    if (normalizedStatusFilter !== "PRESTADO") return null;
    if (prestadoMetrics) return prestadoMetrics;

    let total = 0;
    let totalCost = 0;

    filteredItems.forEach((item) => {
      const units = item.stock > 0 ? item.stock : 1;
      const price = Number(item.price ?? 0);
      if (Number.isFinite(price)) {
        total += price * units;
      }

      const cost = parseCurrencyLikeNumber(item.extraData?.precio_compra);
      if (cost !== null) {
        totalCost += cost * units;
      }
    });

    const roundedTotal = roundCurrencyValue(total);
    return {
      total: roundedTotal,
      debt: roundedTotal,
      profit: roundCurrencyValue(roundedTotal - roundCurrencyValue(totalCost))
    };
  }, [filteredItems, normalizedStatusFilter, prestadoMetrics]);

  return (
    <>
      {!isManualOnly && toastNotification && (
        <div className="fixed right-4 top-4 z-50 w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.4em] text-amber-400">Mercado Libre</p>
              <p className="text-sm text-slate-100">{toastNotification.message}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {formatRelativeTime(toastNotification.createdAt)}
              </p>
            </div>
            <button
              type="button"
              className="rounded-full border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:border-amber-400"
              onClick={() => {
                if (toastTimeoutRef.current) {
                  clearTimeout(toastTimeoutRef.current);
                  toastTimeoutRef.current = null;
                }
                setToastNotification(null);
              }}
            >
              ×
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            {toastNotification.itemId && (
              <span className="font-mono text-[11px] tracking-wide">{toastNotification.itemId}</span>
            )}
            {toastNotification.status && (
              <span className={`rounded-full border px-2 py-0.5 text-[11px] ${getStatusBadgeClass(toastNotification.status)}`}>
                {toastNotification.status}
              </span>
            )}
          </div>
        </div>
      )}
      {!isManualOnly && notificationViewer && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setNotificationViewer(null)}
        >
          <div
            className="w-full max-w-5xl rounded-2xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-100">{notificationViewer.title}</p>
                {notificationViewer.subtitle && (
                  <p className="text-xs text-slate-400">{notificationViewer.subtitle}</p>
                )}
              </div>
              <button
                type="button"
                className="rounded-md border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:border-amber-400"
                onClick={() => setNotificationViewer(null)}
              >
                Cerrar
              </button>
            </div>
            <div className="flex max-h-[80vh] items-center justify-center overflow-hidden rounded-xl bg-black/40 p-2">
              <img
                src={notificationViewer.src}
                alt={notificationViewer.title}
                className="max-h-[75vh] w-auto max-w-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 sm:py-8">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-6">
          <header className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm sm:p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400">Inventario</p>
            <div className="mt-2 flex flex-col gap-3 sm:mt-3 sm:flex-row sm:items-center sm:justify-between">
              <h1 className="text-2xl font-semibold">Stock y precios</h1>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link
                  href="/panel"
                  className="rounded-md border border-emerald-400/50 bg-emerald-500/10 px-3 py-2 text-center text-sm font-semibold text-emerald-100 hover:bg-emerald-500/20"
                >
                  Volver al menú
                </Link>
                {!isManualOnly && (
                  <Link
                    href="/finanzas"
                    className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-center text-sm font-semibold text-amber-200 hover:bg-amber-500/20"
                  >
                    Control de gastos
                  </Link>
                )}
                {!isManualOnly && canCreateManual && (
                  <Link
                    href="/inventory/manual"
                    className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-center text-sm font-semibold text-amber-200 hover:bg-amber-500/20"
                  >
                    Captura manual
                  </Link>
                )}
                <a
                  href="/api/auth/signout"
                  className="rounded-md border border-slate-700 px-3 py-2 text-center text-sm text-slate-200 hover:border-amber-400"
                >
                  Cerrar sesion
                </a>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-300">Carga manual o importa Excel. Encabezados aceptados: SKU/CODIGO, DESCRIPCION o DESCRIPCION ML o DESCRIPCION LOCAL, PRECIO, INVENTARIO/STOCK/CANTIDAD, CODIGO DE MERCADO LIBRE, CODIGO UNIVERSAL, ESTATUS (active/paused/inactive), ESTATUS INTERNO, ORIGEN, MARCA, COCHE, AÑO DESDE, AÑO HASTA, UBICACION, FACEBOOK, PIEZA.</p>
          </header>
  {!isManualOnly && (
  <section className="bg-slate-900/70 border border-slate-700 rounded-2xl p-4 shadow space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Notificaciones Mercado Libre</h2>
              <p className="text-xs text-slate-400">Mostrando las ultimas 10 notificaciones. Puedes cargar 10 mas por bloque o buscar eventos anteriores.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fetchNotifications({ silent: false })}
                disabled={notificationsLoading}
                className="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-100 hover:border-amber-400 disabled:opacity-60"
              >
                {notificationsLoading ? "Actualizando..." : "Actualizar"}
              </button>
              <button
                type="button"
                onClick={() => toggleSection("notifications")}
                className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-200 hover:bg-amber-500/20"
              >
                {sectionVisibility.notifications ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </div>

          <div className={sectionVisibility.notifications ? "space-y-3" : "hidden"}>
            <form
              onSubmit={handleNotificationsSearchSubmit}
              className="flex flex-col gap-2 rounded-xl border border-slate-700 bg-slate-950/30 p-3 sm:flex-row sm:items-center"
            >
              <input
                type="text"
                value={notificationsSearch}
                onChange={(event) => setNotificationsSearch(event.target.value)}
                placeholder="Buscar por pieza, SKU, marca, coche, ano, ubicacion o estatus"
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={notificationsLoading}
                  className="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-100 hover:border-amber-400 disabled:opacity-60"
                >
                  Buscar
                </button>
                <button
                  type="button"
                  onClick={clearNotificationsSearch}
                  disabled={notificationsLoading || !notificationsSearch.trim().length}
                  className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
                >
                  Limpiar
                </button>
              </div>
            </form>

            {notifications.length ? (
              <>
                <ul className="divide-y divide-slate-700 text-sm text-slate-100">
                  {notifications.map((entry) => (
                    <li key={entry.id} className="space-y-3 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-700 bg-slate-950/70">
                            {entry.photoPreview ? (
                              <button
                                type="button"
                                className="h-full w-full cursor-zoom-in"
                                onClick={() =>
                                  setNotificationViewer({
                                    src: entry.photoPreview!,
                                    title: entry.piece ? `Foto ${entry.piece}` : "Foto de pieza",
                                    subtitle: entry.skuInternal ? `SKU: ${entry.skuInternal}` : null
                                  })
                                }
                              >
                                <img
                                  src={entry.photoPreview}
                                  alt={entry.piece ? `Miniatura ${entry.piece}` : "Miniatura de pieza"}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                  decoding="async"
                                />
                              </button>
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">
                                Sin foto
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-base leading-tight text-slate-100">{entry.message}</p>
                            <p className="mt-1 text-xs text-slate-400">{formatRelativeTime(entry.createdAt)}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-slate-400">
                          {entry.itemId && <span className="font-mono tracking-wide">{entry.itemId}</span>}
                          {entry.status && (
                            <span className={`rounded-full border px-2 py-0.5 ${getStatusBadgeClass(entry.status)}`}>
                              {entry.status}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="overflow-x-auto pb-1">
                        <div className="flex min-w-max items-center gap-4 text-sm text-slate-200">
                          <p className="whitespace-nowrap">Pieza: {entry.piece || "-"}</p>
                          <p className="whitespace-nowrap">SKU: {entry.skuInternal || "-"}</p>
                          <p className="whitespace-nowrap">Marca: {entry.marca || "-"}</p>
                          <p className="whitespace-nowrap">Coche: {entry.coche || "-"}</p>
                          <p className="whitespace-nowrap">Ano: {entry.ano || "-"}</p>
                          <p className="whitespace-nowrap">Ubicacion: {entry.ubicacion || "-"}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>

                {notificationsHasMore && (
                  <div className="flex justify-center pt-1">
                    <button
                      type="button"
                      onClick={loadMoreNotifications}
                      disabled={notificationsLoading || notificationsLoadingMore}
                      className="rounded-md border border-amber-400/50 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      {notificationsLoadingMore ? "Cargando..." : "Cargar 10 mas"}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-400">
                {notificationsSearch.trim().length
                  ? "No hay notificaciones que coincidan con la busqueda."
                  : "Sin eventos recientes."}
              </p>
            )}
          </div>
        </section>
        )}

        {isManualOnly && (
        <section className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4 shadow space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Carga manual</h2>
              <p className="text-xs text-slate-400">
                {isManualOnly
                  ? "Completa el formulario para dar de alta una pieza sin cargar todo el inventario."
                  : "Abrimos la captura manual en una página aparte para no descargar todo el catálogo cada vez."}
              </p>
            </div>
            {!isManualOnly && canCreateManual && (
              <Link
                href="/inventory/manual"
                className="hidden rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-200 hover:bg-amber-500/20 md:inline-flex"
              >
                Abrir captura manual
              </Link>
            )}
          </div>
          <div className={isManualOnly ? "block" : isMobile && !sectionVisibility.manual ? "hidden" : "block"}>
            {isManualOnly ? (
              canCreateManual ? (
                <div className="space-y-3">
                  <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900/70 p-1">
                    <button
                      type="button"
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                        manualTab === "capture"
                          ? "bg-emerald-500/20 text-emerald-100"
                          : "text-slate-300 hover:text-slate-100"
                      }`}
                      onClick={() => setManualTab("capture")}
                    >
                      Captura
                    </button>
                    <button
                      type="button"
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                        manualTab === "nomenclatures"
                          ? "bg-amber-500/20 text-amber-100"
                          : "text-slate-300 hover:text-slate-100"
                      }`}
                      onClick={() => setManualTab("nomenclatures")}
                    >
                      Nomenclaturas
                    </button>
                  </div>

                  {manualTab === "capture" ? (
                    <form
                      className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3"
                      onSubmit={onSubmit}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input
                        className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                        placeholder="Codigo ML"
                        value={form.mlItemId}
                        onChange={(e) => setForm((f) => ({ ...f, mlItemId: e.target.value.toUpperCase() }))}
                      />
                      <select
                        className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                        value={form.estatusInterno}
                        onChange={(e) => setForm((f) => ({ ...f, estatusInterno: e.target.value }))}
                      >
                        <option value="">Estatus interno</option>
                        {sortedEstatusInternoOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                      <input
                        className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                        placeholder="Stock"
                        value={form.stock}
                        onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
                      />
                      <input
                        className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                        placeholder="Pieza"
                        value={form.pieza}
                        onChange={(e) => setForm((f) => ({ ...f, pieza: e.target.value.toUpperCase() }))}
                        list="pieza-options"
                      />
                      <input
                        className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                        list="brand-options"
                        placeholder="Marca"
                        value={form.marca}
                        onChange={(e) => setForm((f) => ({ ...f, marca: e.target.value.toUpperCase(), coche: "" }))}
                      />
                      <input
                        className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                        list="model-options"
                        placeholder={form.marca ? "Coche" : "Coche (elige o escribe)"}
                        value={form.coche}
                        onChange={(e) => setForm((f) => ({ ...f, coche: e.target.value.toUpperCase() }))}
                        disabled={!form.marca && modelOptions.length > 0}
                      />
                      <input
                        className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                        placeholder="Año desde"
                        type="number"
                        min="1950"
                        max="2100"
                        value={form.anoDesde}
                        onChange={(e) => setForm((f) => ({ ...f, anoDesde: e.target.value }))}
                      />
                      <input
                        className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                        placeholder="Año hasta"
                        type="number"
                        min="1950"
                        max="2100"
                        value={form.anoHasta}
                        onChange={(e) => setForm((f) => ({ ...f, anoHasta: e.target.value }))}
                      />
                      <select
                        className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                        value={form.origen}
                        onChange={(e) => setForm((f) => ({ ...f, origen: e.target.value }))}
                      >
                        <option value="">Origen</option>
                        {sortedOrigenOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                      <input
                        className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                        placeholder="Precio"
                        value={form.price}
                        onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                      />
                      <input
                        className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                        placeholder="Precio de compra"
                        value={form.precioCompra}
                        onChange={(e) => setForm((f) => ({ ...f, precioCompra: e.target.value }))}
                      />
                      <input
                        className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                        list="ubicacion-options"
                        placeholder="Ubicacion"
                        value={form.ubicacion}
                        onChange={(e) => setForm((f) => ({ ...f, ubicacion: e.target.value.toUpperCase() }))}
                      />

                      <div className="sm:col-span-3 space-y-3">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>Fotos (hasta {MAX_PHOTOS} imagenes)</span>
                          <span>
                            {photoFiles.length} / {MAX_PHOTOS}
                          </span>
                        </div>
                        <input
                          ref={photoInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            handleManualPhotoFiles(e.target.files);
                            e.currentTarget.value = "";
                          }}
                        />
                        <input
                          ref={cameraInputRef}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            handleManualPhotoFiles(e.target.files);
                            e.currentTarget.value = "";
                          }}
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-100 hover:bg-slate-700"
                            onClick={() => photoInputRef.current?.click()}
                          >
                            Elegir de galeria
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-200 hover:bg-amber-500/20"
                            onClick={() => cameraInputRef.current?.click()}
                          >
                            Tomar foto
                          </button>
                          {photoFiles.length > 0 && (
                            <button
                              type="button"
                              className="rounded-md border border-slate-600/60 px-3 py-1.5 text-xs uppercase tracking-wide text-slate-300 hover:text-white"
                              onClick={clearManualPhotos}
                            >
                              Limpiar todas
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">
                          Puedes elegir imagenes de tu galeria o abrir directamente la camara. Luego edita, gira o agrega
                          notas antes de enviar la pieza.
                        </p>
                        {photoFiles.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-[11px] text-slate-400">
                              La primera imagen queda como portada. Usa las flechas o el botón Portada para reordenar.
                            </p>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                              {photoFiles.map((file, index) => {
                                const key = makePhotoKey(file);
                                const isEdited = Boolean(editedPhotos[key]);
                                const isCover = index === 0;
                                const previewSrc = editedPhotos[key] || manualPhotoPreviewUrls[key] || "";
                                return (
                                  <div
                                    key={`${file.name}-${file.lastModified}-${index}`}
                                    className={`rounded-lg border p-2 text-xs text-slate-200 ${
                                      isCover
                                        ? "border-emerald-400/60 bg-emerald-500/10"
                                        : "border-slate-700 bg-slate-900/70"
                                    }`}
                                  >
                                    <div className="relative overflow-hidden rounded-md border border-slate-700 bg-slate-950/70">
                                      {previewSrc ? (
                                        <img
                                          src={previewSrc}
                                          alt={`Miniatura ${index + 1}`}
                                          className="h-24 w-full object-cover"
                                          loading="lazy"
                                          decoding="async"
                                        />
                                      ) : (
                                        <div className="flex h-24 w-full items-center justify-center text-[10px] text-slate-500">
                                          Sin vista previa
                                        </div>
                                      )}
                                      <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-slate-100">
                                        {index + 1}
                                      </span>
                                      {isCover && (
                                        <span className="absolute right-1 top-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                                          Portada
                                        </span>
                                      )}
                                    </div>
                                    <p className="truncate" title={file.name}>
                                      {file.name}
                                    </p>
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                      {isEdited && (
                                        <span className="rounded-full border border-emerald-400/50 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-200">
                                          Editada
                                        </span>
                                      )}
                                      {!isCover && (
                                        <button
                                          type="button"
                                          className="text-[11px] text-emerald-300 hover:text-emerald-200"
                                          onClick={() => setManualCoverPhoto(index)}
                                        >
                                          Portada
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="text-[11px] text-slate-300 hover:text-slate-100 disabled:opacity-40"
                                        onClick={() => moveManualPhoto(index, index - 1)}
                                        disabled={index === 0}
                                      >
                                        ←
                                      </button>
                                      <button
                                        type="button"
                                        className="text-[11px] text-slate-300 hover:text-slate-100 disabled:opacity-40"
                                        onClick={() => moveManualPhoto(index, index + 1)}
                                        disabled={index >= photoFiles.length - 1}
                                      >
                                        →
                                      </button>
                                      <button
                                        type="button"
                                        className="text-[11px] text-amber-300 hover:text-amber-200"
                                        onClick={() => openPhotoEditorForFile(file)}
                                      >
                                        Editar
                                      </button>
                                      <button
                                        type="button"
                                        className="text-[11px] text-rose-300 hover:text-rose-200"
                                        onClick={() => removeManualPhoto(index)}
                                      >
                                        Quitar
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      <datalist id="sku-options">
                        {skuSuggestions.map((sku) => (
                          <option key={sku} value={sku} />
                        ))}
                      </datalist>
                      <datalist id="brand-options">
                        {brandSuggestions.map((brand) => (
                          <option key={brand} value={brand} />
                        ))}
                      </datalist>
                      <datalist id="model-options">
                        {modelOptions.map((model) => (
                          <option key={model} value={model} />
                        ))}
                      </datalist>
                      <datalist id="ubicacion-options">
                        {ubicacionSuggestions.map((u) => (
                          <option key={u} value={u} />
                        ))}
                      </datalist>
                      <datalist id="pieza-options">
                        {Array.from(
                          new Set(
                            items
                              .map((item) => item.extraData?.pieza)
                              .filter((p): p is string => Boolean(p && p.trim()))
                          )
                        )
                          .sort()
                          .map((pieza) => (
                            <option key={pieza} value={pieza} />
                          ))}
                      </datalist>

                      <div className="sm:col-span-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_3fr] sm:items-center">
                          <input
                            className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                            placeholder="SKU interno *"
                            list="sku-options"
                            value={form.skuInternal}
                            onChange={(e) => {
                              setManualSkuEdited(true);
                              setForm((f) => ({ ...f, skuInternal: e.target.value.toUpperCase() }));
                            }}
                            required
                          />
                          <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-200">
                            {manualSkuSuggestionLoading ? (
                              <span>Calculando siguiente SKU...</span>
                            ) : manualSkuSuggestion ? (
                              <>
                                <span>Sugerido: {manualSkuSuggestion}</span>
                                <button
                                  type="button"
                                  className="rounded-md border border-emerald-400/50 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-100 hover:bg-emerald-500/20"
                                  onClick={() => {
                                    setManualSkuEdited(false);
                                    applyManualSkuSuggestion(manualSkuSuggestion, true);
                                  }}
                                >
                                  Usar sugerido
                                </button>
                              </>
                            ) : (
                              <span>
                                Configura una coincidencia exacta en Nomenclaturas para autollenar el siguiente SKU.
                              </span>
                            )}
                            {manualSkuSuggestionError && (
                              <span className="text-amber-300">{manualSkuSuggestionError}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="sm:col-span-3 flex items-center gap-3">
                        <button
                          type="submit"
                          disabled={pending}
                          className="px-4 py-2 rounded-md bg-primary text-white font-semibold hover:bg-teal-700 disabled:opacity-60"
                        >
                          {pending ? "Guardando..." : "Guardar"}
                        </button>
                        {message && <span className="text-sm text-amber-300">{message}</span>}
                      </div>
                    </form>
                  ) : (
                    <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                      <div className="space-y-2">
                        <p className="text-xs text-slate-400">
                          1) Crea primero la nomenclatura (ej. FAR). 2) Después agrega las piezas exactas que deben usar esa nomenclatura.
                        </p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                          <input
                            className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                            placeholder="Nomenclatura (ej. FAR)"
                            value={manualNomenclaturePrefixDraft}
                            onChange={(e) => setManualNomenclaturePrefixDraft(e.target.value.toUpperCase())}
                          />
                          <button
                            type="button"
                            onClick={createManualNomenclature}
                            disabled={manualNomenclatureLoading}
                            className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-200 hover:bg-amber-500/20 disabled:opacity-60"
                          >
                            Crear nomenclatura
                          </button>
                        </div>
                      </div>

                      {manualNomenclatureGroups.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs text-slate-400">Nomenclaturas registradas</p>
                          {manualNomenclatureGroups.map((group) => {
                            const isSelected = group.id === manualNomenclatureSelectedId;
                            return (
                              <div
                                key={group.id}
                                className={`flex flex-col gap-2 rounded-lg border p-2 sm:flex-row sm:items-center sm:justify-between ${
                                  isSelected
                                    ? "border-emerald-400/50 bg-emerald-500/10"
                                    : "border-slate-700 bg-slate-950/60"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => setManualNomenclatureSelectedId(group.id)}
                                  className="text-left text-sm text-slate-100"
                                >
                                  <span className="font-mono font-semibold tracking-wide text-emerald-200">{group.prefix}</span>
                                  <span className="ml-2 text-xs text-slate-400">{group.pieces.length} piezas</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeManualNomenclature(group.id)}
                                  className="self-start rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-rose-200 hover:bg-rose-500/20 sm:self-auto"
                                >
                                  Eliminar nomenclatura
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">Todavia no hay nomenclaturas configuradas.</p>
                      )}

                      <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-xs text-slate-400">
                          Agrega piezas exactas a la nomenclatura seleccionada (ej. FARO DERECHO, FARO IZQUIERDO).
                        </p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
                          <select
                            className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                            value={manualNomenclatureSelectedId}
                            onChange={(e) => setManualNomenclatureSelectedId(e.target.value)}
                            disabled={!manualNomenclatureGroups.length}
                          >
                            {!manualNomenclatureGroups.length && <option value="">Sin nomenclaturas</option>}
                            {manualNomenclatureGroups.map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.prefix}
                              </option>
                            ))}
                          </select>
                          <input
                            className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                            placeholder="Pieza exacta (ej. FARO DERECHO)"
                            value={manualNomenclaturePieceDraft}
                            onChange={(e) => setManualNomenclaturePieceDraft(e.target.value.toUpperCase())}
                            disabled={!manualNomenclatureGroups.length}
                          />
                          <button
                            type="button"
                            onClick={addPieceToManualNomenclature}
                            disabled={!manualNomenclatureGroups.length || manualNomenclatureLoading}
                            className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-200 hover:bg-amber-500/20 disabled:opacity-60"
                          >
                            Agregar pieza
                          </button>
                        </div>
                      </div>

                      {selectedManualNomenclature ? (
                        <div className="space-y-2">
                          <p className="text-xs text-slate-400">
                            Piezas exactas para <span className="font-mono text-emerald-200">{selectedManualNomenclature.prefix}</span>
                          </p>
                          {selectedManualNomenclature.pieces.length > 0 ? (
                            <div className="space-y-2">
                              {selectedManualNomenclature.pieces.map((pieceEntry) => (
                                <div
                                  key={pieceEntry.id}
                                  className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-950/60 p-2 sm:flex-row sm:items-center sm:justify-between"
                                >
                                  <span className="text-sm text-slate-100">{pieceEntry.piece}</span>
                                  <button
                                    type="button"
                                    onClick={() => removeManualNomenclaturePiece(pieceEntry.id)}
                                    className="self-start rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-rose-200 hover:bg-rose-500/20 sm:self-auto"
                                  >
                                    Eliminar pieza
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-slate-400">Esta nomenclatura todavía no tiene piezas.</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">Selecciona una nomenclatura para ver y administrar sus piezas.</p>
                      )}

                      {manualNomenclatureLoading && <span className="text-sm text-slate-300">Actualizando nomenclaturas...</span>}
                      {manualNomenclatureError && <span className="text-sm text-rose-300">{manualNomenclatureError}</span>}
                      {message && <span className="text-sm text-amber-300">{message}</span>}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-400">
                  Tu rol solo permite consultar inventario. Pide a un administrador que te dé acceso de capturista si necesitas agregar productos.
                </p>
              )
            ) : canCreateManual ? (
              <div className="space-y-3 text-sm text-slate-300">
                <p>
                  Para capturar una pieza sin esperar a que cargue todo el inventario, usa la nueva vista dedicada. Puedes abrirla sin cerrar esta pestaña.
                </p>
                <Link
                  href="/inventory/manual"
                  className="inline-flex rounded-md border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-amber-200 hover:bg-amber-500/20 md:hidden"
                >
                  Abrir captura manual
                </Link>
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                Tu rol solo permite consultar inventario. Pide a un administrador que te dé acceso de capturista si necesitas agregar productos.
              </p>
            )}
          </div>
        </section>
        )}

  {!isManualOnly && (
  <>
  <section className="hidden bg-slate-800/80 border border-slate-700 rounded-2xl p-4 shadow space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Importar Excel</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={downloadTemplate}
                disabled={downloading}
                className="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-100 hover:border-amber-400 disabled:opacity-60"
              >
                {downloading ? "Descargando..." : "Descargar plantilla"}
              </button>
              {canImportInventory && (
                <button
                  type="button"
                  onClick={() => toggleSection("import")}
                  className="rounded-md border border-transparent px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-300 md:hidden"
                >
                  {sectionVisibility.import ? "Ocultar" : "Mostrar"}
                </button>
              )}
            </div>
          </div>
          <div className={isMobile && canImportInventory && !sectionVisibility.import ? "hidden" : "space-y-3"}>
            {canImportInventory ? (
              <>
                <form className="flex flex-col gap-3 sm:flex-row" onSubmit={onUpload}>
                  <input
                    type="file"
                    name="file"
                    accept=".xlsx,.xls,.csv"
                    className="text-sm text-slate-200"
                  />
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={uploading}
                      className="rounded-md bg-primary px-4 py-2 font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                    >
                      {uploading ? "Importando..." : "Importar"}
                    </button>
                    <button
                      type="button"
                      onClick={downloadTemplate}
                      disabled={downloading}
                      className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:border-amber-400 disabled:opacity-60 sm:hidden"
                    >
                      {downloading ? "Descargando..." : "Descargar plantilla"}
                    </button>
                  </div>
                </form>
                {uploadMessage && <p className="text-sm text-amber-300">{uploadMessage}</p>}
                {uploadErrors.length > 0 && (
                  <div className="space-y-1 text-xs text-slate-200">
                    {uploadErrors.slice(0, 5).map((err, i) => (
                      <div key={i}>• {err}</div>
                    ))}
                    {uploadErrors.length > 5 && <div>... y mas ({uploadErrors.length - 5})</div>}
                  </div>
                )}
                <p className="text-xs text-slate-400">Encabezados soportados: ESTATUS, DESCRIPCION, DESCRIPCION ML, DESCRIPCION LOCAL, PRECIO, CODIGO, STOCK, CODIGO UNIVERSAL, CODIGO DE MERCADO LIBRE, ESTATUS INTERNO, ORIGEN, MARCA, COCHE, AÑO DESDE, AÑO HASTA, UBICACION, FACEBOOK, PIEZA.</p>
              </>
            ) : (
              <p className="text-sm text-slate-400">
                Solo administradores pueden importar archivos. Utiliza la captura manual para dar de alta productos.
              </p>
            )}
          </div>
        </section>

        <section className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4 shadow space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Inventario cargado</h2>
              <p className="text-xs text-slate-400">Selecciona filas para borrar, busca por SKU, titulo o codigo de Mercado Libre.</p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
              <div className="flex w-full flex-wrap items-center gap-2 sm:justify-end">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar..."
                  className="w-full sm:w-64 rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                />
                <span className="text-xs text-slate-400">
                  Mostrando {paginatedVisibleStart}-{paginatedVisibleEnd} de {useServerPagination ? totalItems : filteredItems.length}
                </span>
              </div>
              <div className={`grid w-full grid-cols-1 gap-2 ${normalizedStatusFilter === "PRESTADO" ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
                <select
                  value={inventoryMarcaFilter}
                  onChange={(event) => setInventoryMarcaFilter(event.target.value)}
                  className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
                >
                  <option value="">Marca (todas)</option>
                  {inventoryMarcaOptions.map((marca) => (
                    <option key={marca} value={marca}>
                      {marca}
                    </option>
                  ))}
                </select>
                <select
                  value={inventoryCocheFilter}
                  onChange={(event) => setInventoryCocheFilter(event.target.value)}
                  className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
                >
                  <option value="">Coche (todos)</option>
                  {inventoryCocheOptions.map((coche) => (
                    <option key={coche} value={coche}>
                      {coche}
                    </option>
                  ))}
                </select>
                <select
                  value={inventoryPiezaFilter}
                  onChange={(event) => setInventoryPiezaFilter(event.target.value)}
                  className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
                >
                  <option value="">Pieza (todas)</option>
                  {inventoryPiezaOptions.map((pieza) => (
                    <option key={pieza} value={pieza}>
                      {pieza}
                    </option>
                  ))}
                </select>
                {normalizedStatusFilter === "PRESTADO" && (
                  <div className="rounded-md border border-slate-700 bg-gradient-to-b from-slate-900 to-slate-950 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">Me debe (uno o varios)</p>
                      <span className="text-[10px] text-slate-500">
                        {normalizedPrestadoDebtorFilters.length
                          ? `${normalizedPrestadoDebtorFilters.length} seleccionados`
                          : "Sin selección"}
                      </span>
                    </div>
                    {visiblePrestadoDebtorOptions.length > 0 ? (
                      <div className="mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">
                        {visiblePrestadoDebtorOptions.map((debtor) => {
                          const isActive = normalizedPrestadoDebtorFilterSet.has(debtor);
                          return (
                            <button
                              key={debtor}
                              type="button"
                              onClick={() => togglePrestadoDebtorFilter(debtor)}
                              className={`rounded-full border px-2 py-1 text-[11px] font-semibold transition ${
                                isActive
                                  ? "border-cyan-400/80 bg-cyan-500/20 text-cyan-100"
                                  : "border-slate-600 bg-slate-900/70 text-slate-200 hover:border-cyan-400/60"
                              }`}
                            >
                              {debtor}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-[11px] text-slate-500">
                        No hay personas disponibles con los filtros actuales.
                      </p>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setInventoryMarcaFilter("");
                    setInventoryCocheFilter("");
                    setInventoryPiezaFilter("");
                    setPrestadoDebtorFilters([]);
                  }}
                  disabled={!inventoryMarcaFilter && !inventoryCocheFilter && !inventoryPiezaFilter && prestadoDebtorFilters.length === 0}
                  className="rounded-md border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-amber-400 disabled:opacity-50"
                >
                  Limpiar filtros
                </button>
              </div>
            </div>
          </div>
          <div className="hidden rounded-2xl border border-slate-700 bg-slate-900/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.4em] text-slate-400">Seleccion actual</p>
              {focusedRowInfo && (
                <span className="text-[11px] text-slate-500">Se actualiza al cambiar de celda</span>
              )}
            </div>
            {focusedRowInfo ? (
              <div className="mt-3 grid gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-slate-400">SKU</p>
                  <p className="text-xl font-semibold tracking-wide text-slate-100">{focusedRowInfo.sku}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Coche</p>
                  <p className="text-xl font-semibold text-slate-100">{focusedRowInfo.coche}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Año</p>
                  <p className="text-xl font-semibold text-slate-100">{focusedRowInfo.ano}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Descripción</p>
                  <p className="text-xl font-semibold text-slate-100">
                    {(() => {
                      const item = items.find((it) => it.skuInternal === focusedRowInfo.sku);
                      if (!item) return "-";
                      const extra = item.extraData ?? {};
                      const yearSegment = extra.ano_desde || extra.ano_hasta
                        ? extra.ano_desde && extra.ano_hasta && extra.ano_desde !== extra.ano_hasta
                          ? `${extra.ano_desde}-${extra.ano_hasta}`
                          : extra.ano_desde ?? extra.ano_hasta
                        : "";
                      const parts = [extra.pieza, extra.marca, extra.coche, yearSegment, item.skuInternal]
                        .map((part) => (part ?? "").toString().trim())
                        .filter((part) => part.length);
                      return parts.length ? parts.join(" ") : "-";
                    })()}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">
                Selecciona una celda o marca un registro para ver el SKU, el coche, el rango de años y la descripción.
              </p>
            )}
          </div>
          {false && (canManageMercadoLibre ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-900/60 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-xs text-slate-400">Acciones Mercado Libre</p>
                <p className="text-[11px] text-slate-500">
                  {selectedWithMlCount
                    ? `${selectedWithMlCount} ${selectedWithMlCount === 1 ? "seleccionado" : "seleccionados"} con codigo`
                    : "Selecciona registros con codigo de Mercado Libre"}
                  {hasSelectedWithoutMl ? " · Algunos seleccionados no tienen codigo" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => performMlAction("pause")}
                  disabled={mlActionDisabled}
                  className="rounded-md border border-amber-400 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-200 hover:bg-amber-400/10 disabled:opacity-60"
                >
                  {mlAction === "pause" ? "Pausando..." : "Pausar en ML"}
                </button>
                <button
                  type="button"
                  onClick={() => performMlAction("activate")}
                  disabled={mlActionDisabled}
                  className="rounded-md border border-teal-400 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-teal-200 hover:bg-teal-400/10 disabled:opacity-60"
                >
                  {mlAction === "activate" ? "Activando..." : "Activar en ML"}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-400">
              Tu rol no puede pausar o activar publicaciones en Mercado Libre.
            </div>
          ))}
          {statusCounters.length > 0 && (
            <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-700 bg-slate-900/60 p-3 text-[11px] uppercase tracking-wide text-slate-200">
              {statusCounters.map(([label, count]) => {
                const isActive = statusFilter === label;
                const baseClasses = "flex items-center gap-2 rounded-xl border px-3 py-1 text-left transition focus:outline-none";
                const activeClasses = isActive
                  ? "border-amber-400 bg-amber-400/20 text-amber-100"
                  : "border-slate-600 bg-slate-800/70 hover:border-amber-300";
                return (
                  <button
                    type="button"
                    key={label}
                    onClick={() => {
                      const nextStatus = isActive ? null : label;
                      setStatusFilter(nextStatus);
                    }}
                    className={`${baseClasses} ${activeClasses}`}
                  >
                    <span className="text-base font-bold text-amber-300">{count}</span>
                    <span className="font-semibold">{label}</span>
                  </button>
                );
              })}
            </div>
          )}
          {prestadoSummary && (
            <div className="grid grid-cols-1 gap-2 rounded-2xl border border-sky-500/30 bg-sky-950/20 p-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Total prestado</p>
                <p className="mt-1 text-lg font-semibold text-emerald-300">{formatCurrencyMx(prestadoSummary.total)}</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Me deben</p>
                <p className="mt-1 text-lg font-semibold text-amber-300">{formatCurrencyMx(prestadoSummary.debt)}</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Utilidad estimada</p>
                <p className={`mt-1 text-lg font-semibold ${prestadoSummary.profit >= 0 ? "text-cyan-300" : "text-rose-300"}`}>
                  {formatCurrencyMx(prestadoSummary.profit)}
                </p>
              </div>
            </div>
          )}
          {filteredItems.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-300">
              <span>
                Página {inventoryPage} de {filteredTotalPages} · registros {paginatedVisibleStart}-{paginatedVisibleEnd}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInventoryPage(1)}
                  disabled={inventoryPage === 1}
                  className="rounded-md border border-slate-600 px-2 py-1 text-xs hover:border-amber-400 disabled:opacity-50"
                >
                  «
                </button>
                <button
                  type="button"
                  onClick={() => setInventoryPage((prev) => Math.max(1, prev - 1))}
                  disabled={inventoryPage === 1}
                  className="rounded-md border border-slate-600 px-3 py-1 text-xs hover:border-amber-400 disabled:opacity-50"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setInventoryPage((prev) => Math.min(filteredTotalPages, prev + 1))}
                  disabled={inventoryPage >= filteredTotalPages}
                  className="rounded-md border border-slate-600 px-3 py-1 text-xs hover:border-amber-400 disabled:opacity-50"
                >
                  Siguiente
                </button>
                <button
                  type="button"
                  onClick={() => setInventoryPage(filteredTotalPages)}
                  disabled={inventoryPage >= filteredTotalPages}
                  className="rounded-md border border-slate-600 px-2 py-1 text-xs hover:border-amber-400 disabled:opacity-50"
                >
                  »
                </button>
              </div>
            </div>
          )}
          <p className="text-xs text-slate-400">
            {loadingPage
              ? "Cargando registros..."
              : `Mostrando ${paginatedVisibleStart}-${paginatedVisibleEnd} de ${
                  useServerPagination ? totalItems : filteredItems.length
                } filtrados (${items.length} cargados${useServerPagination ? " en esta pagina" : ""})`}
          </p>
          {isMobile && (
          <div className="mt-4 space-y-3">
            {filteredItems.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-6 text-center text-sm text-slate-400">
                {workerSearchPending
                  ? "Filtrando registros..."
                  : "No hay registros que coincidan con el filtro aplicado."}
              </div>
            ) : (
              paginatedFilteredItems.map((item) => {
                const extra = item.extraData ?? {};
                const internalStatusRaw = (extra.estatus_interno ?? "").toString().trim();
                const internalStatus = internalStatusRaw.length ? internalStatusRaw.toUpperCase() : "SIN ESTATUS";
                const yearLabel = getItemYearLabel(item);
                const pieceName = getItemPieceName(item);
                const isSelected = selectedIdSet.has(item.id);
                const cardStatusClass = internalStatus === "VENDIDO"
                  ? "bg-rose-950/40"
                  : internalStatus === "PRESTADO"
                  ? "bg-sky-950/40"
                  : "";
                const photosCount = typeof item.photoCount === "number" ? item.photoCount : 0;
                const previewEnabled = thumbnailsActive && photosCount > 0;
                const previewSrc = previewEnabled ? getThumbnailSrc(item.id) : null;

                return (
                  <article
                    key={item.id}
                    className={`rounded-2xl border border-slate-700 bg-slate-900/60 p-3 shadow-sm ${cardStatusClass}`}
                    onClick={() => setFocusedRowInfo(toFocusedInfo(item))}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-tight text-white">{pieceName}</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          SKU: {item.skuInternal || "-"}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${getStatusBadgeClass(item.status)}`}>
                        {item.status || "sin estatus"}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">Precio</p>
                        <p className="font-semibold text-emerald-300">{formatCurrencyMx(item.price)}</p>
                      </div>
                      <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">Stock</p>
                        <p className="font-semibold text-slate-100">{item.stock}</p>
                      </div>
                      <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">Marca / Coche</p>
                        <p className="font-semibold text-slate-100">
                          {(extra.marca ?? "-").toString()} / {(extra.coche ?? "-").toString()}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">Año / Ubicacion</p>
                        <p className="font-semibold text-slate-100">{yearLabel} / {(extra.ubicacion ?? "-").toString()}</p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-amber-400 focus:ring-amber-400"
                        checked={isSelected}
                        onChange={(event) => {
                          event.stopPropagation();
                          toggleItemSelection(item.id);
                        }}
                      />

                      {canEditInventory ? (
                        <select
                          value={internalStatusRaw}
                          onChange={(event) => {
                            event.stopPropagation();
                            handleEstatusInternoChange(item, event.target.value);
                          }}
                          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
                        >
                          <option value="">SIN ESTATUS</option>
                          {sortedEstatusInternoOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200">
                          {internalStatus}
                        </span>
                      )}

                      <button
                        type="button"
                        className={`ml-auto relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60 text-[10px] text-slate-500 ${
                          canEditInventory ? "hover:border-amber-300" : "opacity-60"
                        }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (canEditInventory) {
                            openPhotoModal(item);
                          }
                        }}
                        disabled={!canEditInventory}
                        aria-label={photosCount ? "Ver fotos" : "Sin fotos"}
                      >
                        {previewEnabled ? (
                          <>
                            <span className="absolute inset-0 flex items-center justify-center text-slate-400">Foto</span>
                            <img
                              src={previewSrc ?? undefined}
                              alt={`Miniatura ${pieceName}`}
                              className="relative h-full w-full object-cover"
                              loading="lazy"
                              decoding="async"
                              onError={(event) => {
                                event.currentTarget.style.display = "none";
                              }}
                            />
                          </>
                        ) : (
                          <span className="text-slate-400">Sin</span>
                        )}
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      <span>ML: {item.mlItemId || "-"}</span>
                      <span>•</span>
                      <span>{photosCount ? `${photosCount} fotos` : "Sin fotos"}</span>
                    </div>

                    {canEditInventory && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-amber-400/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200 hover:border-amber-300"
                          onClick={(event) => {
                            event.stopPropagation();
                            openInventoryEditModal(item);
                          }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-rose-400/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-rose-200 hover:border-rose-300"
                          onClick={(event) => {
                            event.stopPropagation();
                            requestDeleteAuthorization([item.id]);
                          }}
                        >
                          Borrar
                        </button>
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
          )}
          {!isMobile && (
          <div
            ref={desktopTableContainerRef}
            onScroll={(event) => {
              if (!shouldVirtualizeDesktop) return;
              const nextRowStart = Math.floor(event.currentTarget.scrollTop / tableRowHeight);
              setTableScrollRowStart((current) => (current === nextRowStart ? current : nextRowStart));
            }}
            className="mt-4 overflow-auto rounded-2xl border border-slate-800 bg-slate-950/30 shadow-inner shadow-black/40"
            style={{ maxHeight: tableHeaderHeight + tableViewportHeight }}
          >
            {filteredItems.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                {workerSearchPending
                  ? "Filtrando registros..."
                  : "No hay registros que coincidan con el filtro aplicado."}
              </div>
            ) : (
              <table className="min-w-[1100px] w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-slate-900/90 text-xs font-semibold uppercase tracking-widest text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left">Sel</th>
                    <th className="px-4 py-3 text-left">Editar</th>
                    <th className="px-4 py-3 text-left">
                      <div className="flex items-center gap-2">
                        <span>Estatus interno</span>
                        <button
                          type="button"
                          className="text-[10px] text-slate-300 hover:text-amber-200"
                          onClick={() => toggleSort("estatusInterno")}
                        >
                          {getSortIndicator("estatusInterno")}
                        </button>
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <div className="flex items-center gap-2">
                        <span>Pieza</span>
                        <button
                          type="button"
                          className="text-[10px] text-slate-300 hover:text-amber-200"
                          onClick={() => toggleSort("pieza")}
                        >
                          {getSortIndicator("pieza")}
                        </button>
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left">Fotos</th>
                    <th className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span>Precio</span>
                        <button
                          type="button"
                          className="text-[10px] text-slate-300 hover:text-amber-200"
                          onClick={() => toggleSort("precio")}
                        >
                          {getSortIndicator("precio")}
                        </button>
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <div className="flex items-center gap-2">
                        <span>SKU</span>
                        <button
                          type="button"
                          className="text-[10px] text-slate-300 hover:text-amber-200"
                          onClick={() => toggleSort("sku")}
                        >
                          {getSortIndicator("sku")}
                        </button>
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left">Codigo ML</th>
                    <th className="px-4 py-3 text-left">
                      <div className="flex items-center gap-2">
                        <span>Estatus</span>
                        <button
                          type="button"
                          className="text-[10px] text-slate-300 hover:text-amber-200"
                          onClick={() => toggleSort("status")}
                        >
                          {getSortIndicator("status")}
                        </button>
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left">Descripcion</th>
                    <th className="px-4 py-3 text-left">Descripcion ML</th>
                    <th className="px-4 py-3 text-left">Descripcion local</th>
                    <th className="px-4 py-3 text-left">
                      <div className="flex items-center gap-2">
                        <span>Marca</span>
                        <button
                          type="button"
                          className="text-[10px] text-slate-300 hover:text-amber-200"
                          onClick={() => toggleSort("marca")}
                        >
                          {getSortIndicator("marca")}
                        </button>
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <div className="flex items-center gap-2">
                        <span>Coche</span>
                        <button
                          type="button"
                          className="text-[10px] text-slate-300 hover:text-amber-200"
                          onClick={() => toggleSort("coche")}
                        >
                          {getSortIndicator("coche")}
                        </button>
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <div className="flex items-center gap-2">
                        <span>Año</span>
                        <button
                          type="button"
                          className="text-[10px] text-slate-300 hover:text-amber-200"
                          onClick={() => toggleSort("ano")}
                        >
                          {getSortIndicator("ano")}
                        </button>
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left">Origen</th>
                    <th className="px-4 py-3 text-left">Ubicacion</th>
                    <th className="px-4 py-3 text-left">Prestado/Vendido a</th>
                    <th className="px-4 py-3 text-left">Fecha ingreso</th>
                    <th className="px-4 py-3 text-left">Fecha prestamo</th>
                    <th className="px-4 py-3 text-left">Facebook</th>
                    <th className="px-4 py-3 text-left">Inventario</th>
                    <th className="px-4 py-3 text-left">Revision</th>
                    <th className="px-4 py-3 text-left">Codigo universal</th>
                    <th className="px-4 py-3 text-right">Stock</th>
                    <th className="px-4 py-3 text-right">Precio compra</th>
                    <th className="px-4 py-3 text-left">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {virtualizedDesktopRows.topSpacerHeight > 0 && (
                    <tr aria-hidden="true">
                      <td
                        colSpan={INVENTORY_TABLE_COLUMN_COUNT}
                        style={{ height: virtualizedDesktopRows.topSpacerHeight, padding: 0, border: 0 }}
                      />
                    </tr>
                  )}
                  {virtualizedDesktopRows.rows.map((item) => {
                    const extra = item.extraData ?? {};
                    const internalStatusRaw = (extra.estatus_interno ?? "").toString().trim();
                    const internalStatus = internalStatusRaw.length ? internalStatusRaw.toUpperCase() : "SIN ESTATUS";
                    const yearLabel = getItemYearLabel(item);
                    const pieceName = getItemPieceName(item);
                    const isSelected = selectedIdSet.has(item.id);
                    const isEditing = editingRowId === item.id;
                    const rowStatusClass = internalStatus === "VENDIDO"
                      ? "bg-rose-950/40"
                      : internalStatus === "PRESTADO"
                      ? "bg-sky-950/40"
                      : "";
                    const photosCount = typeof item.photoCount === "number" ? item.photoCount : 0;
                    const mlUrl = item.mlItemId ? `https://articulo.mercadolibre.com.mx/${item.mlItemId}` : null;
                    const previewEnabled = thumbnailsActive && photosCount > 0;
                    const previewSrc = previewEnabled ? getThumbnailSrc(item.id) : null;
                    return (
                      <tr
                        key={item.id}
                        className={`h-14 border-t border-slate-900/80 bg-slate-900/30 hover:bg-slate-900/70 ${rowStatusClass}`}
                        onClick={() => setFocusedRowInfo(toFocusedInfo(item))}
                      >
                        <td className="whitespace-nowrap px-4 py-3 align-middle">
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-amber-400 focus:ring-amber-400"
                              checked={isSelected}
                              onChange={(event) => {
                                event.stopPropagation();
                                toggleItemSelection(item.id);
                              }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle text-xs">
                          {canEditInventory ? (
                            <button
                              type="button"
                              className="rounded-md border border-amber-400/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200 transition hover:border-amber-300"
                              onClick={(event) => {
                                event.stopPropagation();
                                openInventoryEditModal(item);
                              }}
                            >
                              Editar
                            </button>
                          ) : (
                            <span className="text-slate-500">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-middle text-xs font-semibold text-slate-100">
                          {canEditInventory ? (
                            <select
                              value={internalStatusRaw}
                              onChange={(event) => handleEstatusInternoChange(item, event.target.value)}
                              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
                            >
                              <option value="">SIN ESTATUS</option>
                              {sortedEstatusInternoOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : (
                            internalStatus
                          )}
                        </td>
                        <td className="min-w-[220px] px-4 py-3 align-top">
                          <div className="font-semibold text-white">{pieceName}</div>
                          {extra.ubicacion && (
                            <div className="text-xs text-slate-500">Ubicacion: {extra.ubicacion}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-middle text-xs">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              className={`relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60 text-[10px] text-slate-500 ${
                                canEditInventory ? "hover:border-amber-300" : "opacity-60"
                              }`}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (canEditInventory) {
                                  openPhotoModal(item);
                                }
                              }}
                              disabled={!canEditInventory}
                              aria-label={photosCount ? "Ver fotos" : "Sin fotos"}
                            >
                              {previewEnabled ? (
                                <>
                                  <span className="absolute inset-0 flex items-center justify-center text-slate-400">Foto</span>
                                  <img
                                    src={previewSrc ?? undefined}
                                    alt={`Miniatura ${pieceName}`}
                                    className="relative h-full w-full object-cover"
                                    loading="lazy"
                                    decoding="async"
                                    onError={(event) => {
                                      event.currentTarget.style.display = "none";
                                    }}
                                  />
                                </>
                              ) : (
                                <span className="text-slate-400">{photosCount ? "Ver" : "Sin"}</span>
                              )}
                            </button>
                            <div className="text-xs text-slate-400">
                              {photosCount ? `${photosCount} fotos` : "Sin fotos"}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right align-middle font-bold text-emerald-300">
                          {canEditInventory && isEditing ? (
                            <input
                              type="text"
                              defaultValue={item.price != null ? String(item.price) : ""}
                              onBlur={(event) => handlePriceBlur(item, event.currentTarget.value)}
                              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-emerald-200 text-right focus:border-amber-400 focus:outline-none"
                              placeholder="$"
                            />
                          ) : item.price != null ? (
                            formatCurrencyMx(item.price)
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 align-middle">
                          {canEditInventory && isEditing ? (
                            <input
                              type="text"
                              defaultValue={(item.skuInternal ?? "").toString()}
                              onBlur={(event) => handleSkuBlur(item, event.currentTarget.value)}
                              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-amber-200 focus:border-amber-400 focus:outline-none"
                              placeholder="SKU"
                            />
                          ) : (
                            <div className="flex flex-col">
                              <span className="font-mono text-sm text-amber-200">{item.skuInternal || "-"}</span>
                              <span className="text-[11px] text-slate-500">{item.status || "-"}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-middle text-xs">
                          {canEditInventory && isEditing ? (
                            <input
                              type="text"
                              defaultValue={(item.mlItemId ?? "").toString()}
                              onBlur={(event) => handleMlItemBlur(item, event.currentTarget.value)}
                              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
                              placeholder="ML ID"
                            />
                          ) : (
                            <span className="text-slate-200">{item.mlItemId || "-"}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-100">{item.status || "-"}</td>
                        <td className="min-w-[240px] px-4 py-3 align-top text-slate-100">
                          <div className="max-w-[320px] truncate">{pieceName}</div>
                        </td>
                        <td className="min-w-[220px] px-4 py-3 align-top text-slate-100">
                          <div className="max-w-[320px] truncate">{extra.descripcion_ml ?? "-"}</div>
                        </td>
                        <td className="min-w-[220px] px-4 py-3 align-top text-slate-100">
                          <div className="max-w-[320px] truncate">{(() => {
                            const base = (extra.descripcion_local ?? "").toString().trim();
                            const origen = (extra.origen ?? "").toString().trim().toUpperCase();
                            if (origen === "NUEVO ORIGINAL") {
                              const prefix = base ? `${base}\n\n` : "";
                              return `${prefix}${nuevoOriginalDescripcion}`;
                            }
                            if (origen === "NUEVO ORIGINAL CON DETALLE") {
                              const prefix = base ? `${base}\n\n` : "";
                              return `${prefix}${nuevoOriginalDetalleDescripcion}`;
                            }
                            if (origen === "TW/GENERICO") {
                              const prefix = base ? `${base}\n\n` : "";
                              return `${prefix}${twGenericoDescripcion}`;
                            }
                            if (origen === "TW/GENERICO CON DETALLE") {
                              const prefix = base ? `${base}\n\n` : "";
                              return `${prefix}${twGenericoDetalleDescripcion}`;
                            }
                            if (origen === "USADO ORIGINAL SANO") {
                              const prefix = base ? `${base}\n\n` : "";
                              return `${prefix}${usadoOriginalSanoDescripcion}`;
                            }
                            if (origen === "USADO ORIGINAL CON DETALLE") {
                              const prefix = base ? `${base}\n\n` : "";
                              return `${prefix}${usadoOriginalDetalleDescripcion}`;
                            }
                            return base || "-";
                          })()}</div>
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-100">
                          {canEditInventory && isEditing ? (
                            <input
                              type="text"
                              defaultValue={(extra.marca ?? "").toString()}
                              onBlur={(event) => handleMarcaBlur(item, event.currentTarget.value)}
                              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
                              placeholder="Marca"
                            />
                          ) : (
                            extra.marca ?? "-"
                          )}
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-100">
                          {canEditInventory && isEditing ? (
                            <input
                              type="text"
                              defaultValue={(extra.coche ?? "").toString()}
                              onBlur={(event) => handleCocheBlur(item, event.currentTarget.value)}
                              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
                              placeholder="Coche"
                            />
                          ) : (
                            extra.coche ?? "-"
                          )}
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-100">
                          {canEditInventory && isEditing ? (
                            <input
                              type="text"
                              defaultValue={
                                extra.ano_desde || extra.ano_hasta
                                  ? `${extra.ano_desde ?? ""}-${extra.ano_hasta ?? ""}`
                                  : ""
                              }
                              onBlur={(event) => handleAnoBlur(item, event.currentTarget.value)}
                              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
                              placeholder="Año"
                            />
                          ) : (
                            yearLabel
                          )}
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-100">
                          {canEditInventory && isEditing ? (
                            <select
                              value={(extra.origen ?? "").toString()}
                              onChange={(event) => handleOrigenChange(item, event.target.value)}
                              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
                            >
                              <option value="">-</option>
                              {sortedOrigenOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : (
                            extra.origen ?? "-"
                          )}
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-100">
                          {canEditInventory && isEditing ? (
                            <input
                              type="text"
                              defaultValue={(extra.ubicacion ?? "").toString()}
                              onBlur={(event) => handleUbicacionBlur(item, event.currentTarget.value)}
                              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
                              placeholder="Ubicacion"
                            />
                          ) : (
                            extra.ubicacion ?? "-"
                          )}
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-100">
                          {extra.prestado_vendido_a ?? "-"}
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-100">
                          {extra.fecha_ingreso ? formatDate(extra.fecha_ingreso) : "-"}
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-100">
                          {extra.fecha_prestamo_pago ? formatDate(extra.fecha_prestamo_pago) : "-"}
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-100">
                          {extra.facebook ?? "-"}
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-100">
                          {extra.inventario ?? "-"}
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-100">
                          {extra.revision ?? "-"}
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-100">
                          {item.sellerCustomField ?? "-"}
                        </td>
                        <td className="px-4 py-3 text-right align-middle font-semibold text-slate-100">{item.stock}</td>
                        <td className="px-4 py-3 text-right align-middle font-semibold text-slate-100">
                          {extra.precio_compra != null ? formatCurrencyMx(extra.precio_compra) : "-"}
                        </td>
                        <td className="px-4 py-3 align-middle text-xs">
                          {canEditInventory ? (
                            <div className="flex flex-col gap-2">
                              <button
                                type="button"
                                className="rounded-md border border-amber-400/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200 hover:border-amber-300"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openInventoryEditModal(item);
                                }}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                className="text-red-300 hover:text-red-200"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  requestDeleteAuthorization([item.id]);
                                }}
                              >
                                Borrar
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-500">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {virtualizedDesktopRows.bottomSpacerHeight > 0 && (
                    <tr aria-hidden="true">
                      <td
                        colSpan={INVENTORY_TABLE_COLUMN_COUNT}
                        style={{ height: virtualizedDesktopRows.bottomSpacerHeight, padding: 0, border: 0 }}
                      />
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
          )}
        </section>
        </>
        )}
      </div>
      </main>
      {inventoryEditForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-6xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-100">Editar registro</h3>
                <p className="text-xs text-slate-400">
                  Ajusta cualquier campo de captura manual y guarda los cambios.
                </p>
              </div>
              <button
                type="button"
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:border-amber-300 disabled:opacity-50"
                onClick={closeInventoryEditModal}
                disabled={inventoryEditSaving}
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <input
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                placeholder="SKU interno *"
                value={inventoryEditForm.skuInternal}
                onChange={(event) => handleInventoryEditFieldChange("skuInternal", event.target.value.toUpperCase())}
              />
              <input
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                placeholder="Codigo ML"
                value={inventoryEditForm.mlItemId}
                onChange={(event) => handleInventoryEditFieldChange("mlItemId", event.target.value.toUpperCase())}
              />
              <select
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                value={inventoryEditForm.estatusInterno}
                onChange={(event) => handleInventoryEditFieldChange("estatusInterno", event.target.value.toUpperCase())}
              >
                <option value="">SIN ESTATUS</option>
                {sortedEstatusInternoOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              <input
                type="number"
                min="0"
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                placeholder="Stock"
                value={inventoryEditForm.stock}
                onChange={(event) => handleInventoryEditFieldChange("stock", event.target.value)}
              />
              <input
                list="edit-piece-options"
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                placeholder="Pieza"
                value={inventoryEditForm.pieza}
                onChange={(event) => handleInventoryEditFieldChange("pieza", event.target.value.toUpperCase())}
              />
              <input
                list="edit-brand-options"
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                placeholder="Marca"
                value={inventoryEditForm.marca}
                onChange={(event) => handleInventoryEditFieldChange("marca", event.target.value.toUpperCase())}
              />

              <input
                list="edit-model-options"
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none disabled:opacity-60"
                placeholder={inventoryEditForm.marca ? "Coche" : "Coche (elige o escribe)"}
                value={inventoryEditForm.coche}
                onChange={(event) => handleInventoryEditFieldChange("coche", event.target.value.toUpperCase())}
                disabled={!inventoryEditForm.marca && editModelOptions.length > 0}
              />
              <input
                type="number"
                min="1950"
                max="2100"
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                placeholder="Año desde"
                value={inventoryEditForm.anoDesde}
                onChange={(event) => handleInventoryEditFieldChange("anoDesde", event.target.value)}
              />
              <input
                type="number"
                min="1950"
                max="2100"
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                placeholder="Año hasta"
                value={inventoryEditForm.anoHasta}
                onChange={(event) => handleInventoryEditFieldChange("anoHasta", event.target.value)}
              />

              <select
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                value={inventoryEditForm.origen}
                onChange={(event) => handleInventoryEditFieldChange("origen", event.target.value.toUpperCase())}
              >
                <option value="">Origen</option>
                {sortedOrigenOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <input
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                placeholder="Precio"
                value={inventoryEditForm.price}
                onChange={(event) => handleInventoryEditFieldChange("price", event.target.value)}
              />
              <input
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                placeholder="Precio de compra"
                value={inventoryEditForm.precioCompra}
                onChange={(event) => handleInventoryEditFieldChange("precioCompra", event.target.value)}
              />

              <input
                list="edit-ubicacion-options"
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                placeholder="Ubicacion"
                value={inventoryEditForm.ubicacion}
                onChange={(event) => handleInventoryEditFieldChange("ubicacion", event.target.value.toUpperCase())}
              />
              <input
                className="sm:col-span-2 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                placeholder="Prestado/Vendido a"
                value={inventoryEditForm.prestadoVendidoA}
                onChange={(event) => handleInventoryEditFieldChange("prestadoVendidoA", event.target.value.toUpperCase())}
              />
            </div>

            <datalist id="edit-piece-options">
              {piezaSuggestions.map((pieza) => (
                <option key={pieza} value={pieza} />
              ))}
            </datalist>
            <datalist id="edit-brand-options">
              {brandSuggestions.map((brand) => (
                <option key={brand} value={brand} />
              ))}
            </datalist>
            <datalist id="edit-model-options">
              {editModelOptions.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <datalist id="edit-ubicacion-options">
              {ubicacionSuggestions.map((ubicacion) => (
                <option key={ubicacion} value={ubicacion} />
              ))}
            </datalist>

            {inventoryEditError && <p className="mt-3 text-sm text-rose-300">{inventoryEditError}</p>}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                className="rounded-md border border-slate-600 px-4 py-2 text-xs text-slate-200 hover:border-amber-300 disabled:opacity-50"
                onClick={closeInventoryEditModal}
                disabled={inventoryEditSaving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                onClick={saveInventoryEditModal}
                disabled={inventoryEditSaving}
              >
                {inventoryEditSaving ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
      {photoEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
          <div className="w-full max-w-4xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-100">Editar foto</h3>
                <p className="text-xs text-slate-400">{photoEditor.title}</p>
              </div>
              <button
                type="button"
                className="text-sm text-slate-400 hover:text-amber-300"
                onClick={closePhotoEditor}
              >
                Cerrar
              </button>
            </div>
            <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/70 p-3">
              <canvas
                ref={editorCanvasRef}
                className="h-[320px] w-full touch-none rounded-lg border border-slate-800 bg-black"
                onPointerDown={handleEditorPointerDown}
                onPointerMove={handleEditorPointerMove}
                onPointerUp={handleEditorPointerUp}
                onPointerLeave={handleEditorPointerUp}
                onPointerCancel={handleEditorPointerUp}
              />
              {(!photoEditorReady || photoEditorBusy) && (
                <p className="mt-2 text-xs text-slate-400">Preparando imagen...</p>
              )}
            </div>
            {photoEditorError && <p className="mt-3 text-sm text-rose-300">{photoEditorError}</p>}
            <p className="mt-2 text-xs text-slate-400">
              {pendingText
                ? "Toca la imagen para colocar el texto."
                : drawingMode
                ? annotationTool === "brush"
                  ? "Arrastra con el dedo o el mouse para dibujar."
                  : annotationTool === "circle"
                    ? "Arrastra para trazar un círculo."
                    : "Arrastra para trazar una flecha."
                : "Activa el modo dibujo o agrega texto para resaltar detalles."}
            </p>
            <div className="mt-4 space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-600 px-3 py-1.5 text-xs uppercase tracking-wide text-slate-200 hover:border-amber-300 disabled:opacity-50"
                  onClick={() => rotateEditorCanvas("left")}
                  disabled={!photoEditorReady}
                >
                  Rotar -90°
                </button>
                <button
                  type="button"
                  className="rounded-md border border-slate-600 px-3 py-1.5 text-xs uppercase tracking-wide text-slate-200 hover:border-amber-300 disabled:opacity-50"
                  onClick={() => rotateEditorCanvas("right")}
                  disabled={!photoEditorReady}
                >
                  Rotar +90°
                </button>
                <button
                  type="button"
                  className="rounded-md border border-slate-600 px-3 py-1.5 text-xs uppercase tracking-wide text-slate-200 hover:border-amber-300 disabled:opacity-50"
                  onClick={() => flipEditorCanvas("horizontal")}
                  disabled={!photoEditorReady}
                >
                  Voltear horizontal
                </button>
                <button
                  type="button"
                  className="rounded-md border border-slate-600 px-3 py-1.5 text-xs uppercase tracking-wide text-slate-200 hover:border-amber-300 disabled:opacity-50"
                  onClick={() => flipEditorCanvas("vertical")}
                  disabled={!photoEditorReady}
                >
                  Voltear vertical
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <button
                  type="button"
                  className={`rounded-md border px-3 py-1.5 font-semibold uppercase tracking-wide ${
                    drawingMode
                      ? "border-emerald-400 bg-emerald-500/10 text-emerald-100"
                      : "border-slate-600 text-slate-300 hover:border-emerald-300"
                  }`}
                  onClick={() => setDrawingMode((value) => !value)}
                  disabled={!photoEditorReady}
                >
                  {drawingMode ? "Salir de dibujo" : "Modo dibujo"}
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Herramienta:</span>
                  {([
                    { id: "brush", label: "Pincel" },
                    { id: "circle", label: "Círculo" },
                    { id: "arrow", label: "Flecha" }
                  ] as Array<{ id: AnnotationTool; label: string }>).map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      className={`rounded-md border px-2 py-1 ${
                        annotationTool === tool.id
                          ? "border-amber-400 bg-amber-500/10 text-amber-100"
                          : "border-slate-600 text-slate-300"
                      }`}
                      onClick={() => setAnnotationTool(tool.id)}
                      disabled={!photoEditorReady}
                    >
                      {tool.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Color:</span>
                  {drawingColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`h-6 w-6 rounded-full border ${
                        drawingColor === color ? "border-white" : "border-transparent"
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setDrawingColor(color)}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Grosor:</span>
                  {[3, 5, 7].map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={`rounded-md border px-2 py-1 ${
                        brushSize === size
                          ? "border-amber-400 bg-amber-500/10 text-amber-100"
                          : "border-slate-600 text-slate-300"
                      }`}
                      onClick={() => setBrushSize(size)}
                    >
                      {size}px
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="rounded-md border border-slate-600 px-3 py-1.5 font-semibold uppercase tracking-wide text-slate-200 hover:border-amber-300 disabled:opacity-50"
                  onClick={handleAddText}
                  disabled={!photoEditorReady}
                >
                  Agregar texto
                </button>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs uppercase tracking-wide text-slate-300 hover:border-amber-300 disabled:opacity-50"
                onClick={resetEditorCanvas}
                disabled={!photoEditorReady}
              >
                Reiniciar
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-600 px-4 py-2 text-xs text-slate-200 hover:border-amber-300"
                onClick={closePhotoEditor}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                onClick={handleSaveEditedPhoto}
                disabled={!photoEditorReady || photoEditorSaving}
              >
                {photoEditorSaving ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
      {photoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-5xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-100">
                Fotos {photoModal.title ? `(${photoModal.title})` : ""}
              </h3>
              <button
                type="button"
                className="text-sm text-slate-300 hover:text-amber-300"
                onClick={closePhotoModal}
              >
                Cerrar
              </button>
            </div>
            <div className="space-y-4 text-sm text-slate-200">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Fotos guardadas</span>
                <span>
                  {modalPhotos.length} / {MAX_PHOTOS}
                </span>
              </div>
              <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[2fr,1fr]">
                <div className="space-y-3">
                  {photoModalLoading ? (
                    <p className="text-xs text-slate-300">Cargando fotos...</p>
                  ) : modalPhotos.length ? (
                    <>
                      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-slate-700 bg-slate-800">
                        <img
                          src={activeModalPhoto || ""}
                          alt={`Foto ${modalActiveIndex + 1}`}
                          className="h-full w-full object-contain"
                        />
                        {modalActiveIndex === 0 && (
                          <span className="absolute left-3 top-3 rounded-full bg-emerald-500/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                            Portada
                          </span>
                        )}
                        {modalPhotos.length > 1 && (
                          <>
                            <button
                              type="button"
                              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-lg text-white hover:bg-black/80"
                              onClick={showPrevModalPhoto}
                            >
                              ‹
                            </button>
                            <button
                              type="button"
                              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-lg text-white hover:bg-black/80"
                              onClick={showNextModalPhoto}
                            >
                              ›
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="absolute top-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs text-rose-200 hover:bg-black/80"
                          onClick={() => removeModalPhoto(modalActiveIndex)}
                        >
                          Quitar esta foto
                        </button>
                        <div className="absolute bottom-3 right-4 rounded-full bg-black/50 px-3 py-1 text-[11px] text-white">
                          {modalActiveIndex + 1} / {modalPhotos.length}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-slate-600 px-3 py-1.5 text-xs uppercase tracking-wide text-slate-200 hover:border-amber-300"
                          onClick={() => openPhotoEditorForModalPhoto(modalActiveIndex)}
                        >
                          Editar foto
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-slate-600 px-3 py-1.5 text-xs uppercase tracking-wide text-slate-200 hover:border-amber-300 disabled:opacity-50"
                          onClick={() => moveActiveModalPhoto("left")}
                          disabled={modalActiveIndex === 0}
                        >
                          Mover izquierda
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-slate-600 px-3 py-1.5 text-xs uppercase tracking-wide text-slate-200 hover:border-amber-300 disabled:opacity-50"
                          onClick={() => moveActiveModalPhoto("right")}
                          disabled={modalActiveIndex >= modalPhotos.length - 1}
                        >
                          Mover derecha
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-emerald-400/50 px-3 py-1.5 text-xs uppercase tracking-wide text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-50"
                          onClick={() => setModalCoverPhoto(modalActiveIndex)}
                          disabled={modalActiveIndex === 0}
                        >
                          Elegir portada
                        </button>
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-2">
                        {modalPhotos.map((src, index) => (
                          <div
                            key={`${src}-${index}`}
                            className={`relative rounded-lg border ${
                              index === modalActiveIndex
                                ? "border-amber-400"
                                : "border-slate-700"
                            } bg-slate-800 p-1`}
                          >
                            {index === 0 && (
                              <span className="absolute left-1 top-1 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                                Portada
                              </span>
                            )}
                            <button
                              type="button"
                              className="block h-16 w-16 overflow-hidden rounded-md"
                              onClick={() => setModalActiveIndex(index)}
                            >
                              <img src={src} alt={`Thumb ${index + 1}`} className="h-full w-full object-cover" />
                            </button>
                            {index > 0 && (
                              <button
                                type="button"
                                className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-emerald-700/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-100 hover:bg-emerald-600"
                                onClick={() => setModalCoverPhoto(index)}
                              >
                                Portada
                              </button>
                            )}
                            <button
                              type="button"
                              className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[10px] text-white hover:bg-black/90"
                              onClick={() => removeModalPhoto(index)}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400">Sin fotos para este registro.</p>
                  )}
                </div>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-xs text-slate-400">Agregar nuevas fotos</p>
                    <input
                      ref={modalPhotoInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple
                      className="w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-2 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1 file:text-[10px] file:uppercase file:tracking-widest"
                      onChange={(e) => handleModalFileSelection(e.target.files)}
                    />
                  </div>
                  {photoModalError && <p className="text-xs text-rose-300">{photoModalError}</p>}
                </div>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  className="rounded-md border border-slate-600 px-4 py-2 text-xs text-slate-200 hover:border-amber-300"
                  onClick={closePhotoModal}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                  onClick={saveModalPhotos}
                  disabled={photoModalSaving}
                >
                  {photoModalSaving ? "Guardando..." : "Guardar cambios"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
