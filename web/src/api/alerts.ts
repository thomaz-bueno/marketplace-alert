import { request } from "./client";

export { ApiError } from "./client";

export interface Alert {
  id: number;
  productName: string;
  city: string;
  maxPrice: number;
  createdAt: string;
  updatedAt: string;
}

export interface AlertInput {
  productName: string;
  city: string;
  maxPrice: number;
}

export const alertsApi = {
  list(): Promise<Alert[]> {
    return request<Alert[]>("/alerts");
  },
  create(input: AlertInput): Promise<Alert> {
    return request<Alert>("/alerts", { method: "POST", body: JSON.stringify(input) });
  },
  update(id: number, input: AlertInput): Promise<Alert> {
    return request<Alert>(`/alerts/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
  remove(id: number): Promise<{ id: number; deleted: true }> {
    return request<{ id: number; deleted: true }>(`/alerts/${id}`, {
      method: "DELETE",
    });
  },
};
