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

let indexedItems: Array<{ id: string; text: string }> = [];

const toText = (value: unknown) => (value === null || value === undefined ? "" : String(value));

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
    extra.pieza,
    extra.marca,
    extra.ano_desde,
    extra.ano_hasta,
    extra.ubicacion,
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
          text: buildInventorySearchText(item)
        }))
      : [];
    return;
  }

  if (payload.type === "search") {
    const query = payload.query.trim().toLowerCase();
    const ids = query.length
      ? indexedItems.filter((entry) => entry.text.includes(query)).map((entry) => entry.id)
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
