import React from 'react';
import TechnicianSalesV2 from './TechnicianSalesV2';

export default function WorkOrderSaleV2(props) {
  const voltarAoApp = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('v2');
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  };
  return <TechnicianSalesV2 {...props} onClose={voltarAoApp} />;
}
