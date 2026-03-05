import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { lookupBarcode } from '../utils/openFoodFacts';
import styles from './BarcodeScanner.module.css';

const READER_ID = 'barcode-reader';

export function BarcodeScanner({ onResult, onClose, onScan }) {
  const [status, setStatus] = useState('Point camera at a barcode');
  const [error, setError] = useState(null);
  const scannerRef = useRef(null);
  const processingRef = useRef(false);

  async function startScanner() {
    setError(null);
    setStatus('Starting camera...');
    processingRef.current = false;

    try {
      const scanner = new Html5Qrcode(READER_ID);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 150 } },
        handleScan,
        () => {} // ignore non-detections
      );

      setStatus('Point camera at a barcode');
    } catch (err) {
      console.error('Camera error:', err);
      setError('Camera access denied. Please allow camera permission and try again.');
      setStatus('');
    }
  }

  async function handleScan(decodedText) {
    if (processingRef.current) return;
    processingRef.current = true;
    setStatus('Looking up product...');
    setError(null);

    try {
      if (scannerRef.current?.isScanning) {
        await scannerRef.current.stop();
      }
    } catch { /* already stopped */ }

    // If parent wants the raw barcode string, pass it up directly
    if (onScan) {
      onScan(decodedText);
      return;
    }

    try {
      const result = await lookupBarcode(decodedText);
      if (result) {
        onResult(result);
      } else {
        setError(`Product not found for barcode: ${decodedText}`);
        setStatus('');
      }
    } catch (err) {
      console.error('Lookup error:', err);
      setError('Network error. Check your connection and try again.');
      setStatus('');
    }
  }

  async function handleRetry() {
    setError(null);
    await startScanner();
  }

  useEffect(() => {
    startScanner();
    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>Scan Barcode</h3>
          <button className={styles.closeBtn} type="button" onClick={onClose}>
            &times;
          </button>
        </div>
        <div id={READER_ID} className={styles.reader} />
        <div className={styles.footer}>
          {status && <span className={styles.status}>{status}</span>}
          {error && (
            <>
              <span className={styles.error}>{error}</span>
              <button className={styles.retryBtn} type="button" onClick={handleRetry}>
                Retry
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
