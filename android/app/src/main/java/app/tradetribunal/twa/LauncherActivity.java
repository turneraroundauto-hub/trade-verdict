/*
 * Copyright 2020 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package app.tradetribunal.twa;

import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Bundle;



public class LauncherActivity
        extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    

    

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Was SCREEN_ORIENTATION_USER_PORTRAIT on Android 8.1+ (with UNSPECIFIED
        // used only <=8.0 to dodge a transparent-background splash crash -- see
        // https://github.com/GoogleChromeLabs/bubblewrap/issues/496). Play Console
        // flagged the portrait lock as a resizability/orientation restriction
        // ("Remove resizability and orientation restrictions... to support large
        // screen devices") that Android 16 ignores outright anyway. UNSPECIFIED on
        // every version defers fully to the system/manifest; the old <=8.0 branch
        // already proved UNSPECIFIED doesn't reintroduce that splash crash.
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    }

    @Override
    protected Uri getLaunchingUrl() {
        // Get the original launch Url.
        Uri uri = super.getLaunchingUrl();

        

        return uri;
    }
}
