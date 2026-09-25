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
