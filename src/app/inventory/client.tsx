"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type SectionKey = "notifications" | "manual" | "import";

type InventoryPageResponse = {
  items: Item[];
  page: number;
  pageSize: number;
  total: number;
  totalPages?: number;
  statusTotals?: Record<string, number>;
};

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
const INVENTORY_PAGE_SIZE = 50;
const MAX_PHOTO_DIMENSION = 1280; // ancho/alto maximo al comprimir
const PHOTO_QUALITY = 0.8; // calidad JPEG al recomprimir
const drawingColors = ["#f87171", "#facc15", "#4ade80", "#38bdf8", "#f472b6", "#ffffff"];
const THUMBNAILS_ENABLED = true;
const THUMBNAIL_PREFETCH_LIMIT = 40; // evita descargas masivas por pagina
const THUMBNAIL_FETCH_GAP_MS = 120;

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
  const [items, setItems] = useState<Item[]>(initialPage.items);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [focusedRowInfo, setFocusedRowInfo] = useState<FocusedInfo | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
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
  const [message, setMessage] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
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
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{
    key: SortKey;
    direction: "asc" | "desc";
  } | null>(null);
  const [photoModalError, setPhotoModalError] = useState<string | null>(null);
  const [photoModalLoading, setPhotoModalLoading] = useState(false);
  const [modalActiveIndex, setModalActiveIndex] = useState(0);
  const [thumbnailCache, setThumbnailCache] = useState<Record<string, string | null>>({});
  const [thumbnailLoadingIds, setThumbnailLoadingIds] = useState<Record<string, boolean>>({});
  const [thumbnailErrors, setThumbnailErrors] = useState<Record<string, string | null>>({});
  const [mlAction, setMlAction] = useState<null | "pause" | "activate">(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastNotificationIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const localEstatusInternoRef = useRef(
    new Map<string, { value: string; updatedAt: number; prestadoVendidoA?: string | null }>()
  );
  const [isMobile, setIsMobile] = useState(false);
  const pageSizeRef = useRef(Math.max(1, initialPage.pageSize || INVENTORY_PAGE_SIZE));
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage.page || 1));
  const [totalItems, setTotalItems] = useState(initialPage.total);
  const [statusTotals, setStatusTotals] = useState<Record<string, number>>(
    normalizeStatusTotals(initialPage.statusTotals)
  );
  const [totalPages, setTotalPages] = useState(
    Math.max(1, initialPage.totalPages ?? Math.ceil(initialPage.total / Math.max(1, initialPage.pageSize || INVENTORY_PAGE_SIZE)))
  );
  const [loadingPage, setLoadingPage] = useState(false);
  const [sectionVisibility, setSectionVisibility] = useState<Record<SectionKey, boolean>>({
    notifications: true,
    manual: true,
    import: true
  });
  const tableVisibleRows = 10;
  const tableRowHeight = 56;
  const tableHeaderHeight = 44;
  const normalizedRole = (userRole ?? "operator").toLowerCase();
  const canEditInventory = normalizedRole === "admin" || normalizedRole === "supervisor";
  const canCreateManual = canEditInventory || normalizedRole === "operator" || normalizedRole === "uploader";
  const canImportInventory = canEditInventory;
  const canManageMercadoLibre = canEditInventory;
  const thumbnailsActive = THUMBNAILS_ENABLED;

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
      setSectionVisibility({ notifications: true, manual: true, import: true });
    }
  }, [isManualOnly, isMobile]);

  const toggleSection = useCallback((section: SectionKey) => {
    if (!isMobile || isManualOnly) return;
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

  const fetchNotifications = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!silent && isMountedRef.current) {
      setNotificationsLoading(true);
    }
    try {
      const res = await fetch("/api/notifications?limit=12", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("No se pudieron obtener las notificaciones");
      }
      const data = await res.json().catch(() => ({}));
      const list: NotificationItem[] = Array.isArray(data.notifications) ? data.notifications : [];
      if (!isMountedRef.current) return;
      setNotifications(list);
      if (!list.length) return;
      const newest = list[0];
      if (!lastNotificationIdRef.current) {
        lastNotificationIdRef.current = newest.id;
        return;
      }
      if (lastNotificationIdRef.current !== newest.id) {
        lastNotificationIdRef.current = newest.id;
        triggerNotificationToast(newest);
      }
    } catch (err: any) {
      if (!silent && isMountedRef.current) {
        setMessage(err?.message || "No se pudieron obtener las notificaciones");
      }
    } finally {
      if (!silent && isMountedRef.current) {
        setNotificationsLoading(false);
      }
    }
  }, [triggerNotificationToast]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
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
    fetchNotifications({ silent: true });
    const interval = setInterval(() => fetchNotifications({ silent: true }), 20000);
    return () => clearInterval(interval);
  }, [fetchNotifications, isManualOnly]);

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

  const fetchInventoryPage = useCallback(
    async (page: number, options?: { preserveSelection?: boolean; statusFilter?: string | null }) => {
      const targetPage = Math.max(1, page);
      setLoadingPage(true);
      try {
        const hasStatusFilterOverride = Boolean(
          options && Object.prototype.hasOwnProperty.call(options, "statusFilter")
        );
        const activeStatusFilter = hasStatusFilterOverride
          ? options?.statusFilter ?? null
          : statusFilter;
        const normalizedStatus = activeStatusFilter?.toString().trim().toUpperCase() ?? null;

        const params = new URLSearchParams({
          page: targetPage.toString(),
          pageSize: pageSizeRef.current.toString()
        });
        if (normalizedStatus) {
          params.set("statusFilter", normalizedStatus);
        }
        const res = await fetch(`/api/inventory?${params.toString()}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "No se pudo obtener el inventario");
        }

        const incoming: Item[] = Array.isArray(data.items) ? data.items : [];
        const now = Date.now();
        const incomingWithLocal = incoming.map((item) => {
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

        const nextPageSize = typeof data.pageSize === "number" && data.pageSize > 0 ? data.pageSize : pageSizeRef.current;
        pageSizeRef.current = nextPageSize;
        const nextTotal = typeof data.total === "number" && data.total >= 0 ? data.total : incomingWithLocal.length;
        const nextStatusTotals = normalizeStatusTotals(data.statusTotals);
        const nextTotalPages =
          typeof data.totalPages === "number" && data.totalPages > 0
            ? data.totalPages
            : Math.max(1, Math.ceil(nextTotal / Math.max(1, nextPageSize)));
        const normalizedPage =
          typeof data.page === "number" && data.page > 0
            ? Math.min(data.page, nextTotalPages)
            : Math.min(targetPage, nextTotalPages);

        if (!incomingWithLocal.length && nextTotal > 0 && normalizedPage > 1) {
          await fetchInventoryPage(normalizedPage - 1, options);
          return;
        }

        setItems((current) => {
          if (!updatingIds.length) {
            return incomingWithLocal;
          }
          const updatingSet = new Set(updatingIds);
          const currentMap = new Map(current.map((item) => [item.id, item]));
          return incomingWithLocal.map((item) => (updatingSet.has(item.id) ? currentMap.get(item.id) ?? item : item));
        });
        setTotalItems(nextTotal);
        setStatusTotals(nextStatusTotals);
        setTotalPages(nextTotalPages);
        setCurrentPage(normalizedPage);

        if (!options?.preserveSelection) {
          setSelectedIds([]);
          setFocusedRowInfo(null);
        }
      } catch (err: any) {
        setMessage(err?.message || "No se pudo obtener el inventario");
      } finally {
        setLoadingPage(false);
      }
    },
    [updatingIds, statusFilter]
  );

  const refresh = useCallback(async () => {
    if (isManualOnly) return;
    await fetchInventoryPage(currentPage, { preserveSelection: false });
  }, [isManualOnly, fetchInventoryPage, currentPage]);

  const goToPreviousPage = useCallback(async () => {
    if (loadingPage || currentPage <= 1) return;
    await fetchInventoryPage(currentPage - 1);
  }, [loadingPage, currentPage, fetchInventoryPage]);

  const goToNextPage = useCallback(async () => {
    if (loadingPage || currentPage >= totalPages) return;
    await fetchInventoryPage(currentPage + 1);
  }, [loadingPage, currentPage, totalPages, fetchInventoryPage]);

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

  const ensureThumbnail = useCallback(
    async (itemId: string) => {
      if (thumbnailCache[itemId] !== undefined || thumbnailLoadingIds[itemId]) return;
      setThumbnailLoadingIds((prev) => ({ ...prev, [itemId]: true }));
      try {
        const res = await fetch(`/api/inventory/${itemId}/photos?limit=1`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "No se pudo obtener la miniatura");
        }
        const preview = Array.isArray(data.photos) ? data.photos[0] ?? null : null;
        setThumbnailCache((prev) => ({ ...prev, [itemId]: preview }));
        setThumbnailErrors((prev) => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
      } catch (err: any) {
        setThumbnailErrors((prev) => ({ ...prev, [itemId]: err?.message || "No se pudo cargar" }));
        setThumbnailCache((prev) => ({ ...prev, [itemId]: null }));
      } finally {
        setThumbnailLoadingIds((prev) => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
      }
    },
    [thumbnailCache, thumbnailLoadingIds]
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
      setThumbnailCache((prev) => ({ ...prev, [photoModal.id]: photosToSave[0] ?? null }));
      setThumbnailErrors((prev) => {
        const next = { ...prev };
        delete next[photoModal.id];
        return next;
      });
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

      const payload = {
        skuInternal: toUpper(form.skuInternal) ?? "",
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

  const updateEstatusInterno = useCallback(async (
    id: string,
    value: string,
    overridePrestadoVendidoA?: string | null
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
          prestadoVendidoA
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "No se pudo actualizar");
      }
      if (data?.mlSyncError) {
        setMessage(`Estatus interno guardado, pero ML falló: ${data.mlSyncError}`);
      }
    } catch (err: any) {
      setItems(prevItems);
      setMessage(err.message || "No se pudo actualizar");
      localEstatusInternoRef.current.delete(id);
    } finally {
      setUpdatingIds((prev) => prev.filter((x) => x !== id));
    }
  }, [items]);

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
      }

      updateExtraDataInState(item.id, {
        estatus_interno: val || undefined,
        ...(overrideBuyer !== undefined ? { prestado_vendido_a: overrideBuyer || undefined } : {})
      });
      updateEstatusInterno(item.id, val, overrideBuyer);
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

  const normalizedSearch = search.trim().toLowerCase();
  const searchFilteredItems = useMemo(() => {
    if (!normalizedSearch) return items;
    return items.filter((item) => {
      const haystack = [
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
      return haystack.includes(normalizedSearch);
    });
  }, [items, normalizedSearch]);

  const normalizedStatusFilter = statusFilter?.toUpperCase() ?? null;
  const filteredItems = useMemo(() => {
    const filtered = normalizedStatusFilter
      ? searchFilteredItems.filter((item) => {
          const current = (item.extraData?.estatus_interno ?? "").toString().trim().toUpperCase();
          const label = current.length ? current : "SIN ESTATUS";
          return label === normalizedStatusFilter;
        })
      : searchFilteredItems;

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
  }, [searchFilteredItems, normalizedStatusFilter, sortConfig, getItemPieceName, getItemYearLabel]);

  const statusCounters = useMemo(() => {
    const localCounts: Record<string, number> = {};
    items.forEach((item) => {
      const key = normalizeStatusLabel(item.extraData?.estatus_interno);
      localCounts[key] = (localCounts[key] ?? 0) + 1;
    });

    const source = Object.keys(statusTotals).length ? statusTotals : localCounts;
    return Object.entries(source).sort((a, b) => {
      if (a[1] === b[1]) {
        return a[0].localeCompare(b[0]);
      }
      return b[1] - a[1];
    });
  }, [items, statusTotals]);

  useEffect(() => {
    if (!thumbnailsActive) return;
    const queue = filteredItems
      .filter((item) => (item.photoCount ?? 0) > 0)
      .slice(0, THUMBNAIL_PREFETCH_LIMIT)
      .map((item) => item.id)
      .filter((id) => thumbnailCache[id] === undefined && !thumbnailLoadingIds[id]);

    if (!queue.length) return;

    let cancelled = false;

    const processQueue = async () => {
      for (const id of queue) {
        if (cancelled) break;
        await ensureThumbnail(id);
        if (cancelled) break;
        await new Promise((resolve) => setTimeout(resolve, THUMBNAIL_FETCH_GAP_MS));
      }
    };

    processQueue();

    return () => {
      cancelled = true;
    };
  }, [thumbnailsActive, filteredItems, ensureThumbnail, thumbnailCache, thumbnailLoadingIds]);

  

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
              <p className="text-xs text-slate-400">Sincronizamos cada 20 segundos o cuando hagas clic en actualizar.</p>
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
                className="rounded-md border border-transparent px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-300 md:hidden"
              >
                {sectionVisibility.notifications ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </div>
          <div className={isMobile && !sectionVisibility.notifications ? "hidden" : "block"}>
            {notifications.length ? (
              <ul className="divide-y divide-slate-700 text-sm text-slate-100">
                {notifications.slice(0, 6).map((entry) => (
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
            ) : (
              <p className="text-sm text-slate-400">Sin eventos recientes.</p>
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
              placeholder="SKU interno *"
              list="sku-options"
              value={form.skuInternal}
              onChange={(e) => setForm((f) => ({ ...f, skuInternal: e.target.value.toUpperCase() }))}
              required
            />
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
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="w-full sm:w-64 rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
              />
              <span className="text-xs text-slate-400">
                Mostrando {filteredItems.length} de {items.length}
              </span>
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
                      void fetchInventoryPage(1, { preserveSelection: false, statusFilter: nextStatus });
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
          <p className="text-xs text-slate-400">
            {loadingPage
              ? `Cargando pagina ${currentPage}...`
              : `Pagina ${currentPage} de ${totalPages} · Mostrando ${items.length} de ${totalItems} registros`}
          </p>
          <div
            className="mt-4 overflow-auto rounded-2xl border border-slate-800 bg-slate-950/30 shadow-inner shadow-black/40"
            style={{ maxHeight: tableHeaderHeight + tableVisibleRows * tableRowHeight }}
          >
            {filteredItems.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                No hay registros que coincidan con el filtro aplicado.
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
                  {filteredItems.map((item) => {
                    const extra = item.extraData ?? {};
                    const internalStatusRaw = (extra.estatus_interno ?? "").toString().trim();
                    const internalStatus = internalStatusRaw.length ? internalStatusRaw.toUpperCase() : "SIN ESTATUS";
                    const yearLabel = getItemYearLabel(item);
                    const pieceName = getItemPieceName(item);
                    const isSelected = selectedIds.includes(item.id);
                    const isEditing = editingRowId === item.id;
                    const rowStatusClass = internalStatus === "VENDIDO"
                      ? "bg-rose-950/40"
                      : internalStatus === "PRESTADO"
                      ? "bg-sky-950/40"
                      : "";
                    const photosCount = typeof item.photoCount === "number" ? item.photoCount : 0;
                    const mlUrl = item.mlItemId ? `https://articulo.mercadolibre.com.mx/${item.mlItemId}` : null;
                    const previewEnabled = thumbnailsActive && photosCount > 0;
                    const previewSrc = previewEnabled ? thumbnailCache[item.id] : null;
                    const previewLoading = previewEnabled && Boolean(thumbnailLoadingIds[item.id]);
                    const previewError = previewEnabled ? thumbnailErrors[item.id] : null;
                    return (
                      <tr
                        key={item.id}
                        className={`h-14 border-t border-slate-900/80 bg-slate-900/30 transition hover:bg-slate-900/70 ${rowStatusClass}`}
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
                              className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition ${
                                isEditing
                                  ? "border-emerald-400/70 bg-emerald-500/10 text-emerald-200"
                                  : "border-amber-400/60 text-amber-200 hover:border-amber-300"
                              }`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingRowId((current) => (current === item.id ? null : item.id));
                              }}
                            >
                              {isEditing ? "Listo" : "Editar"}
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
                              className={`relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60 text-[10px] text-slate-500 transition ${
                                canEditInventory ? "hover:border-amber-300" : "opacity-60"
                              }`}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (canEditInventory) {
                                  openPhotoModal(item);
                                }
                              }}
                              onMouseEnter={() => {
                                if (previewEnabled) ensureThumbnail(item.id);
                              }}
                              onFocus={() => {
                                if (previewEnabled) ensureThumbnail(item.id);
                              }}
                              disabled={!canEditInventory}
                              aria-label={photosCount ? "Ver fotos" : "Sin fotos"}
                            >
                              {previewEnabled ? (
                                previewSrc ? (
                                  <img
                                    src={previewSrc}
                                    alt={`Miniatura ${pieceName}`}
                                    className="h-full w-full object-cover"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : previewLoading ? (
                                  <span className="text-amber-200">Cargando...</span>
                                ) : previewError ? (
                                  <span className="text-rose-200">Error</span>
                                ) : (
                                  <span className="text-slate-400">Pendiente</span>
                                )
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
                                  setEditingRowId((current) => (current === item.id ? null : item.id));
                                }}
                              >
                                {isEditing ? "Listo" : "Editar"}
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
                </tbody>
              </table>
            )}
          </div>
          <div className="mt-4 flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
            <p className="text-[11px] text-slate-500">50 registros por pagina</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goToPreviousPage}
                disabled={loadingPage || currentPage <= 1}
                className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:border-amber-400 disabled:opacity-60"
              >
                Anterior
              </button>
              <span className="min-w-[120px] text-center text-xs text-slate-300">
                Pagina {currentPage}/{totalPages}
              </span>
              <button
                type="button"
                onClick={goToNextPage}
                disabled={loadingPage || currentPage >= totalPages}
                className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:border-amber-400 disabled:opacity-60"
              >
                Siguiente
              </button>
            </div>
          </div>
        </section>
        </>
        )}
      </div>
      </main>
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
