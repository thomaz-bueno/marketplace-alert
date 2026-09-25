import { useState, type FormEvent } from "react";
import type { Alert, AlertInput } from "../api/alerts";

interface Props {
  mode: "create" | "edit";
  initial?: Alert;
  submitting: boolean;
  error: string | null;
  onSubmit: (input: AlertInput) => void;
  onCancel: () => void;
}

type FieldErrors = Partial<Record<"productName" | "city" | "maxPrice", string>>;

export default function AlertForm({
  mode,
  initial,
  submitting,
  error,
  onSubmit,
  onCancel,
}: Props) {
  const [productName, setProductName] = useState(initial?.productName ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [maxPrice, setMaxPrice] = useState(
    initial ? String(initial.maxPrice) : "",
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function clearError(field: keyof FieldErrors): void {
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();

    const price = Number(maxPrice);
    const errors: FieldErrors = {};
    if (productName.trim() === "") {
      errors.productName = "Product name is required";
    }
    if (city.trim() === "") {
      errors.city = "City is required";
    }
    if (maxPrice.trim() === "" || !Number.isFinite(price)) {
      errors.maxPrice = "Enter a valid maximum price";
    } else if (price < 0) {
      errors.maxPrice = "Maximum price cannot be negative";
    }

    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    onSubmit({
      productName: productName.trim(),
      city: city.trim(),
      maxPrice: price,
    });
  }

  return (
    <section className="card form-card">
      <h2>{mode === "create" ? "Create alert" : "Edit alert"}</h2>

      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="alert-product-name">Product name</label>
            <input
              id="alert-product-name"
              name="productName"
              type="text"
              value={productName}
              placeholder="iPhone 13"
              onChange={(event) => {
                setProductName(event.target.value);
                clearError("productName");
              }}
            />
            {fieldErrors.productName && (
              <p className="field-error">{fieldErrors.productName}</p>
            )}
          </div>

          <div className="field">
            <label htmlFor="alert-city">City</label>
            <input
              id="alert-city"
              name="city"
              type="text"
              value={city}
              placeholder="Bauru"
              onChange={(event) => {
                setCity(event.target.value);
                clearError("city");
              }}
            />
            {fieldErrors.city && (
              <p className="field-error">{fieldErrors.city}</p>
            )}
          </div>

          <div className="field">
            <label htmlFor="alert-max-price">Maximum price (R$)</label>
            <input
              id="alert-max-price"
              name="maxPrice"
              type="number"
              min="0"
              step="0.01"
              value={maxPrice}
              placeholder="2000"
              onChange={(event) => {
                setMaxPrice(event.target.value);
                clearError("maxPrice");
              }}
            />
            {fieldErrors.maxPrice && (
              <p className="field-error">{fieldErrors.maxPrice}</p>
            )}
          </div>
        </div>

        <div className="form-actions">
          <button type="button" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting
              ? "Saving…"
              : mode === "create"
                ? "Create"
                : "Save changes"}
          </button>
        </div>
      </form>
    </section>
  );
}
