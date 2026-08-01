type WorkerItem = {
  id: string;
  skuInternal?: string | null;
  title?: string | null;
  price?: number | null;
  stock?: number | null;
  mlItemId?: string | null;
  sellerCustomField?: string | null;
  extraData?: Record<string, unknown> | null;
};

type InventorySearchIndexMessage = {
  type: "index";
  items: WorkerItem[];
};

type InventorySearchQueryMessage = {
  type: "search";
  query: string;
  requestId: number;
};

type InventorySearchWorkerMessage = InventorySearchIndexMessage | InventorySearchQueryMessage;

type InventorySearchWorkerResultMessage = {
  type: "search-result";
  query: string;
  requestId: number;
  ids: string[];
};

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<InventorySearchWorkerMessage>) => void) | null;
  postMessage: (data: InventorySearchWorkerResultMessage) => void;
};

let indexedItems: Array<{ id: string; text: string; anoDesde: number | null; anoHasta: number | null }> = [];

const toText = (value: unknown) => (value === null || value === undefined ? "" : String(value));

const splitSearchTokens = (value: string) => {
  const tokens = value
    .toLowerCase()
    .split(/[\s,.;:/|\\_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length);

  return Array.from(new Set(tokens)).slice(0, 10);
};

const parseSearchYearToken = (token: string) => {
  if (!/^\d{4}$/.test(token)) return null;
  const year = Number.parseInt(token, 10);
  if (!Number.isFinite(year) || year < 1900 || year > 2100) return null;
  return year;
};

const parseYearValue = (value: unknown) => {
  const raw = toText(value);
  const match = raw.match(/\d{4}/);
  if (!match) return null;
  const year = Number.parseInt(match[0], 10);
  if (!Number.isFinite(year) || year < 1900 || year > 2100) return null;
  return year;
};

const matchesYearRange = (anoDesde: number | null, anoHasta: number | null, year: number) => {
  const normalizedFrom = anoDesde ?? anoHasta;
  const normalizedTo = anoHasta ?? anoDesde;
  if (normalizedFrom === null || normalizedTo === null) return false;
  const minYear = Math.min(normalizedFrom, normalizedTo);
  const maxYear = Math.max(normalizedFrom, normalizedTo);
  return year >= minYear && year <= maxYear;
};

const buildInventorySearchText = (item: WorkerItem) => {
  const extra = item.extraData ?? {};

  return [
    item.skuInternal,
    item.title,
    extra.descripcion_local,
    extra.descripcion_ml,
    item.mlItemId,
    item.sellerCustomField,
    extra.estatus_interno,
    extra.origen,
    extra.coche,
    extra.version,
    extra.pieza,
    extra.marca,
    extra.ano_desde,
    extra.ano_hasta,
    extra.ubicacion,
    extra.alto,
    extra.largo,
    extra.ancho,
    extra.peso,
    extra.forma_publicacion,
    extra.observaciones,
    extra.compatibilidades,
    extra.inventario,
    extra.revision,
    extra.facebook,
    extra.prestado_vendido_a,
    extra.fecha_prestamo_pago,
    item.stock,
    item.price
  ]
    .map(toText)
    .join(" ")
    .toLowerCase();
};

workerScope.onmessage = (event) => {
  const payload = event.data;
  if (!payload) return;

  if (payload.type === "index") {
    indexedItems = Array.isArray(payload.items)
      ? payload.items.map((item) => ({
          id: item.id,
          text: buildInventorySearchText(item),
          anoDesde: parseYearValue(item.extraData?.ano_desde),
          anoHasta: parseYearValue(item.extraData?.ano_hasta)
        }))
      : [];
    return;
  }

  if (payload.type === "search") {
    const query = payload.query.trim().toLowerCase();
    const tokenChecks = splitSearchTokens(query).map((token) => ({
      token,
      year: parseSearchYearToken(token)
    }));
    const ids = tokenChecks.length
      ? indexedItems
          .filter((entry) =>
            tokenChecks.every(({ token, year }) => {
              if (entry.text.includes(token)) return true;
              return year !== null && matchesYearRange(entry.anoDesde, entry.anoHasta, year);
            })
          )
          .map((entry) => entry.id)
      : indexedItems.map((entry) => entry.id);

    workerScope.postMessage({
      type: "search-result",
      query,
      requestId: payload.requestId,
      ids
    });
  }
};

export {};
