export type Rol = 'superadmin' | 'administrador' | 'mesero' | 'cocinero';

export interface Usuario {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
  restaurante_id: number | null;
  restaurante: string | null;
}

export type EstadoPedido = 'enviado' | 'en_preparacion' | 'listo' | 'entregado' | 'cancelado';

export interface ItemPedido {
  producto_id: number;
  nombre: string;
  precio_unitario: number;
  cantidad: number;
  cantidad_anterior: number | null;
  cambio: 'agregado' | 'modificado' | 'retirado' | null;
  subtotal: number;
}

export interface Pedido {
  id: number;
  consecutivo: number;
  mesa_id: number;
  mesa: string;
  mesero_id: number | null;
  mesero: string | null;
  estado: EstadoPedido;
  total: number;
  editado: number;
  editado_en: string | null;
  motivo_cancelacion: string | null;
  creado: string;
  preparacion_en: string | null;
  listo_en: string | null;
  entregado_en: string | null;
  cancelado_en: string | null;
  items: ItemPedido[];
}

export interface Mesa {
  id: number;
  numero: string;
  capacidad: number | null;
  estado: 'libre' | 'ocupada';
  estado_vista: 'libre' | 'ocupada' | 'con_pedido';
  mesero_id: number | null;
  mesero: string | null;
  ocupada_en: string | null;
  en_curso: number;
  listos: number;
}

export interface Producto {
  id: number;
  nombre: string;
  descripcion: string | null;
  precio: number;
  imagen: string | null;
  disponible: number;
  agotado: boolean;
  estado_inventario: EstadoInventario;
  // solo administrador
  costo?: number | null;
  activo?: number;
  stock?: number | null;
  reservado?: number;
}

export type EstadoInventario = 'sin_registrar' | 'agotado' | 'bajo' | 'ok';

export interface FilaInventario {
  id: number;
  nombre: string;
  activo: number;
  stock: number | null;
  reservado: number;
  disponible: number;
  estado: EstadoInventario;
  precio: number;
  costo: number | null;
  stock_corte?: number | null;
}

export interface Empleado {
  id: number;
  nombre: string;
  email: string;
  rol: 'mesero' | 'cocinero';
  turno_activo: number;
  horario: { dia: number; inicio: string; fin: string }[];
}

export interface Restaurante {
  id: number;
  nombre: string;
  ciudad: string;
  direccion: string | null;
  plan: 'basico' | 'estandar' | 'dedicada';
  estado: 'activo' | 'inactivo';
  fecha_alta: string;
  motivo_estado: string | null;
  usuarios: number;
}

export interface Notificacion {
  id: number;
  tipo: 'venta' | 'inventario_bajo';
  titulo: string;
  detalle: Record<string, unknown> | null;
  leida: number;
  fecha: string;
}

export interface Venta {
  id: number;
  pedido_id: number;
  consecutivo: number;
  mesa: string;
  mesero: string | null;
  total: number;
  fecha: string;
  items: { nombre: string; cantidad: number; precio: number; subtotal: number }[];
}
