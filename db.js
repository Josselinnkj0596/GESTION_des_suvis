/**
 * BizTrack — Gestionnaire de Base de Données Unifié
 * Supporte le mode Hors-ligne (LocalStorage) et le mode Cloud (Supabase / PostgreSQL)
 */

// --- CONFIGURATION SUPABASE ---
// Remplacez ces valeurs par vos clés Supabase après avoir créé votre projet sur supabase.com
const SUPABASE_URL = "https://tfkjuncikecbbtmkbqek.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_1BmBG3lv1nc4UZlxTF2TQg_R_nQIwGu"; 

let supabaseClient = null;

// Initialisation sécurisée du client Supabase
if (SUPABASE_URL && SUPABASE_ANON_KEY && typeof supabase !== 'undefined') {
    try {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log("🔌 Connecté avec succès à Supabase (PostgreSQL) !");
    } catch (err) {
        console.error("Erreur d'initialisation de Supabase :", err);
    }
}

window.BizTrackDB = {
    // Mode de fonctionnement : 'local' ou 'supabase'
    // Se met automatiquement sur 'supabase' si les clés sont renseignées
    getMode: function() {
        return (SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "" && supabaseClient !== null) ? 'supabase' : 'local';
    },

    // --- 1. SÉCURITÉ & AUTHENTIFICATION ---
    login: async function(code, pin) {
        if (this.getMode() === 'supabase') {
            try {
                // Requête PostgreSQL sur la table 'clients'
                const { data, error } = await supabaseClient
                    .from('clients')
                    .select('*')
                    .eq('code', code)
                    .eq('pin', pin)
                    .single();

                if (error || !data) {
                    // Check Admin
                    if ((code.toUpperCase() === 'ADMIN' || code === '9999') && pin === '9999') {
                        return { success: true, user: { code: 'ADMIN', name: 'Administrateur Général', role: 'admin' } };
                    }
                    return { success: false, message: "Code ou PIN invalide dans Supabase." };
                }
                return { success: true, user: { code: data.code, name: data.name, role: 'client', currency: data.currency } };
            } catch (err) {
                console.error("Erreur auth Supabase :", err);
                return { success: false, message: "Erreur de connexion au serveur cloud." };
            }
        } else {
            // Mode LocalStorage de secours (Fallback)
            const db = this._getLocalDB();
            if ((code.toUpperCase() === 'ADMIN' || code === '9999') && pin === '9999') {
                return { success: true, user: { code: 'ADMIN', name: 'Administrateur Général', role: 'admin' } };
            }
            const client = db.clients.find(c => c.code === code && c.pin === pin);
            if (client) {
                return { success: true, user: { code: client.code, name: client.name, role: 'client', currency: client.currency } };
            }
            return { success: false, message: "Code client ou code PIN invalide localement." };
        }
    },

    // --- 2. RÉCUPÉRATION DES DONNÉES CLIENT ---
    getClientData: async function(clientCode) {
        if (this.getMode() === 'supabase') {
            try {
                // Parallélisation des requêtes PostgreSQL sur Supabase
                const [clientsRes, activitiesRes, categoriesRes, productsRes, salesRes, expensesRes] = await Promise.all([
                    supabaseClient.from('clients').select('*').eq('code', clientCode).single(),
                    supabaseClient.from('activities').select('*').eq('client_id', clientCode),
                    supabaseClient.from('categories').select('*').eq('client_id', clientCode),
                    supabaseClient.from('products').select('*').eq('client_id', clientCode),
                    supabaseClient.from('sales').select('*').eq('client_id', clientCode),
                    supabaseClient.from('expenses').select('*').eq('client_id', clientCode)
                ]);

                return {
                    currency: clientsRes.data ? clientsRes.data.currency : 'FCFA (XOF)',
                    activities: activitiesRes.data || [],
                    categories: categoriesRes.data || [],
                    products: productsRes.data || [],
                    sales: (salesRes.data || []).map(s => this._mapPostgresSaleToLocal(s)),
                    expenses: expensesRes.data || []
                };
            } catch (err) {
                console.error("Erreur lors de la récupération cloud :", err);
                return this._getLocalClientData(clientCode); // Secours local
            }
        } else {
            return this._getLocalClientData(clientCode);
        }
    },

    // --- 3. GESTION DES ACTIVITÉS ---
    addActivity: async function(activity) {
        if (this.getMode() === 'supabase') {
            const pgActivity = {
                id: activity.id,
                client_id: activity.clientId,
                name: activity.name,
                icon: activity.icon,
                color: activity.color,
                description: activity.desc
            };
            await supabaseClient.from('activities').insert([pgActivity]);
        } else {
            const db = this._getLocalDB();
            db.activities.push(activity);
            this._saveLocalDB(db);
        }
    },

    deleteActivity: async function(id) {
        if (this.getMode() === 'supabase') {
            await supabaseClient.from('activities').delete().eq('id', id);
        } else {
            const db = this._getLocalDB();
            db.activities = db.activities.filter(a => a.id !== id);
            db.categories = db.categories.filter(c => c.activityId !== id);
            db.products = db.products.filter(p => !p.categoryId.startsWith(id));
            this._saveLocalDB(db);
        }
    },

    // --- 4. GESTION DES CATÉGORIES & PRODUITS ---
    addCategory: async function(category) {
        if (this.getMode() === 'supabase') {
            const pgCategory = {
                id: category.id,
                client_id: category.clientId,
                activity_id: category.activityId,
                name: category.name
            };
            await supabaseClient.from('categories').insert([pgCategory]);
        } else {
            const db = this._getLocalDB();
            db.categories.push(category);
            this._saveLocalDB(db);
        }
    },

    deleteCategory: async function(id) {
        if (this.getMode() === 'supabase') {
            await supabaseClient.from('categories').delete().eq('id', id);
        } else {
            const db = this._getLocalDB();
            db.categories = db.categories.filter(c => c.id !== id);
            db.products = db.products.filter(p => p.categoryId !== id);
            this._saveLocalDB(db);
        }
    },

    addProduct: async function(product) {
        if (this.getMode() === 'supabase') {
            const pgProduct = {
                id: product.id,
                client_id: product.clientId,
                category_id: product.categoryId,
                name: product.name
            };
            await supabaseClient.from('products').insert([pgProduct]);
        } else {
            const db = this._getLocalDB();
            db.products.push(product);
            this._saveLocalDB(db);
        }
    },

    // --- 5. GESTION DES VENTES ---
    addSale: async function(sale) {
        if (this.getMode() === 'supabase') {
            const pgSale = {
                id: sale.id,
                client_id: sale.clientId,
                activity_id: sale.activityId,
                category_id: sale.categoryId,
                product_id: sale.productId || null,
                date: sale.date,
                quantity: sale.quantity,
                unit_price: sale.unitPrice,
                total: sale.total,
                client_name: sale.clientName,
                payment_method: sale.paymentMethod,
                observation: sale.observation
            };
            await supabaseClient.from('sales').insert([pgSale]);
        } else {
            const db = this._getLocalDB();
            db.sales.push(sale);
            this._saveLocalDB(db);
        }
    },

    deleteSale: async function(id) {
        if (this.getMode() === 'supabase') {
            await supabaseClient.from('sales').delete().eq('id', id);
        } else {
            const db = this._getLocalDB();
            db.sales = db.sales.filter(s => s.id !== id);
            this._saveLocalDB(db);
        }
    },

    // --- 6. GESTION DES DÉPENSES ---
    addExpense: async function(expense) {
        if (this.getMode() === 'supabase') {
            const pgExpense = {
                id: expense.id,
                client_id: expense.clientId,
                date: expense.date,
                amount: expense.amount,
                category: expense.category,
                observation: expense.observation
            };
            await supabaseClient.from('expenses').insert([pgExpense]);
        } else {
            const db = this._getLocalDB();
            db.expenses.push(expense);
            this._saveLocalDB(db);
        }
    },

    deleteExpense: async function(id) {
        if (this.getMode() === 'supabase') {
            await supabaseClient.from('expenses').delete().eq('id', id);
        } else {
            const db = this._getLocalDB();
            db.expenses = db.expenses.filter(e => e.id !== id);
            this._saveLocalDB(db);
        }
    },

    // --- 7. ADMINISTRATION (COMMUN AUX DEUX MODES) ---
    getAllClients: async function() {
        if (this.getMode() === 'supabase') {
            const { data } = await supabaseClient.from('clients').select('*');
            return data || [];
        } else {
            return this._getLocalDB().clients;
        }
    },

    addClient: async function(client) {
        if (this.getMode() === 'supabase') {
            await supabaseClient.from('clients').insert([{
                code: client.code,
                name: client.name,
                pin: client.pin,
                currency: client.currency
            }]);
        } else {
            const db = this._getLocalDB();
            db.clients.push(client);
            this._saveLocalDB(db);
        }
    },

    deleteClient: async function(code) {
        if (this.getMode() === 'supabase') {
            await supabaseClient.from('clients').delete().eq('code', code);
        } else {
            const db = this._getLocalDB();
            db.clients = db.clients.filter(c => c.code !== code);
            db.activities = db.activities.filter(a => a.clientId !== code);
            db.categories = db.categories.filter(c => c.clientId !== code);
            db.products = db.products.filter(p => p.clientId !== code);
            db.sales = db.sales.filter(s => s.clientId !== code);
            db.expenses = db.expenses.filter(e => e.clientId !== code);
            this._saveLocalDB(db);
        }
    },

    updateClientCurrency: async function(clientCode, currency) {
        if (this.getMode() === 'supabase') {
            await supabaseClient.from('clients').update({ currency: currency }).eq('code', clientCode);
        } else {
            const db = this._getLocalDB();
            const idx = db.clients.findIndex(c => c.code === clientCode);
            if (idx !== -1) {
                db.clients[idx].currency = currency;
                this._saveLocalDB(db);
            }
        }
    },

    // --- FONCTIONS PRIVÉES INTERNES ---
    _getLocalDB: function() {
        return JSON.parse(localStorage.getItem('biztrack_db'));
    },

    _saveLocalDB: function(db) {
        localStorage.setItem('biztrack_db', JSON.stringify(db));
    },

    _getLocalClientData: function(clientCode) {
        const db = this._getLocalDB();
        const activities = db.activities.filter(a => a.clientId === clientCode);
        const categories = db.categories.filter(c => c.clientId === clientCode);
        const products = db.products.filter(p => p.clientId === clientCode);
        const sales = db.sales.filter(s => s.clientId === clientCode);
        const expenses = db.expenses.filter(e => e.clientId === clientCode);
        const client = db.clients.find(c => c.code === clientCode);
        return {
            currency: client ? client.currency : 'FCFA (XOF)',
            activities, categories, products, sales, expenses
        };
    },

    _mapPostgresSaleToLocal: function(pgSale) {
        return {
            id: pgSale.id,
            clientId: pgSale.client_id,
            activityId: pgSale.activity_id,
            categoryId: pgSale.category_id,
            productId: pgSale.product_id,
            date: pgSale.date,
            quantity: pgSale.quantity,
            unitPrice: pgSale.unit_price,
            total: pgSale.total,
            clientName: pgSale.client_name,
            paymentMethod: pgSale.payment_method,
            observation: pgSale.observation
        };
    }
};
