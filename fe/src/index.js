import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import { I18nProvider } from './i18n';
import './App.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <I18nProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<App />} />
                    <Route path="/doc/*" element={<App />} />
                    <Route path="/search" element={<App />} />
                </Routes>
            </BrowserRouter>
        </I18nProvider>
    </React.StrictMode>
);