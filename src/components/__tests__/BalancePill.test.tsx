import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { BalancePill } from '../BalancePill';

describe('BalancePill', () => {
  it('shows + sign for positive amounts', () => {
    render(<BalancePill amount={500} currency="ARS" />);
    expect(screen.getByText(/^\+/)).toBeTruthy();
  });

  it('shows − sign for negative amounts', () => {
    render(<BalancePill amount={-200} currency="ARS" />);
    expect(screen.getByText(/^−/)).toBeTruthy();
  });

  it('shows no sign for zero amount', () => {
    render(<BalancePill amount={0} currency="ARS" />);
    // There should be no + or − text anywhere in the output
    expect(screen.queryByText(/^\+/)).toBeNull();
    expect(screen.queryByText(/^−/)).toBeNull();
  });
});
