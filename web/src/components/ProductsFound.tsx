import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { productsApi, type Product } from "../api/products";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function messageFrom(error: unknown): string {
  if (error instanceof ApiError) {
    return error.details.length > 0
      ? error.details.join(" ")
      : error.message;
  }
  return error instanceof Error ? error.message : "Unexpected error";
}

function createdAtLabel(createdAt: string): string | null {
  const time = Date.parse(createdAt);
  return Number.isNaN(time) ? null : new Date(time).toLocaleString();
}

export default function ProductsFound() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProducts(await productsApi.list());
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="muted">Loading products…</p>;
  }

  if (error !== null) {
    return (
      <div className="banner error" role="alert">
        <span>
          Unable to load products. {error}
        </span>
        <button type="button" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <p className="muted">
        No products found.
        <br />
        There are currently no products matching your alerts.
      </p>
    );
  }

  return (
    <ul className="product-grid">
      {products.map((product) => {
        const date = createdAtLabel(product.createdAt);
        return (
          <li key={product.id || product.url} className="card product-card">
            {product.image !== "" && (
              <img src={product.image} alt={product.title} loading="lazy" />
            )}
            <h3>{product.title}</h3>
            <p className="meta price">{brl.format(product.price)}</p>
            <p className="meta">{product.location}</p>
            {product.seller !== "" && (
              <p className="meta">Seller: {product.seller}</p>
            )}
            {product.description !== "" && (
              <p className="product-description">{product.description}</p>
            )}
            {date !== null && <p className="meta">Found {date}</p>}
            <a
              className="product-link"
              href={product.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open listing
            </a>
          </li>
        );
      })}
    </ul>
  );
}
