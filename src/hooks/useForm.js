// src/hooks/useForm.js
// Generic form hook with validation — يُعيد إعادة استخدام نمط النماذج
import { useState, useCallback } from 'react';

/**
 * useForm(initialValues, validatorFn?)
 *
 * validatorFn: (values) => { fieldName: 'error message', ... }
 *
 * Returns: { values, errors, touched, handleChange, handleBlur,
 *             setField, setValues, reset, validate, isValid }
 */
export default function useForm(initialValues, validatorFn = null) {
  const [values,  setValues]  = useState(initialValues);
  const [errors,  setErrors]  = useState({});
  const [touched, setTouched] = useState({});

  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    const val = type === 'checkbox' ? checked : value;
    setValues(prev => ({ ...prev, [name]: val }));
    // Clear error on change
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: undefined }));
  }, [errors]);

  const handleBlur = useCallback((e) => {
    const { name } = e.target;
    setTouched(prev => ({ ...prev, [name]: true }));
    // Validate single field on blur
    if (validatorFn) {
      const allErrors = validatorFn(values);
      setErrors(prev => ({ ...prev, [name]: allErrors[name] }));
    }
  }, [values, validatorFn]);

  const setField = useCallback((name, value) => {
    setValues(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: undefined }));
  }, [errors]);

  const validate = useCallback(() => {
    if (!validatorFn) return true;
    const newErrors = validatorFn(values);
    setErrors(newErrors);
    // Mark all fields as touched
    const allTouched = Object.keys(values).reduce((acc, k) => ({ ...acc, [k]: true }), {});
    setTouched(allTouched);
    return Object.keys(newErrors).length === 0;
  }, [values, validatorFn]);

  const reset = useCallback((newValues = null) => {
    setValues(newValues || initialValues);
    setErrors({});
    setTouched({});
  }, [initialValues]);

  const isValid = Object.keys(errors).filter(k => errors[k]).length === 0;

  return {
    values, errors, touched,
    handleChange, handleBlur,
    setField, setValues, validate, reset, isValid,
  };
}
