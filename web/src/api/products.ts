import { request } from "./client";

export interface Product {
  id: string;
  title: string;
  price: number;
  location: string;
  image: string;
  url: string;
  seller: string;
  description: string;
  createdAt: string;
}

export const productsApi = {
  list(): Promise<Product[]> {
    return request<Product[]>("/products");
  },
};
